import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'
import { z } from 'zod'
import { buildLicense, generateActivationKey, hashKey } from './license-service.js'

const required=['DATABASE_URL','LICENSE_ADMIN_EMAIL','LICENSE_ADMIN_PASSWORD_HASH','JWT_SECRET','LICENSE_PRIVATE_KEY_B64','LICENSE_PUBLIC_KEY_B64','PORTAL_ORIGIN']
for (const k of required) if (!process.env[k]) throw new Error(`Missing required environment variable: ${k}`)
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters')
const privateKey=crypto.createPrivateKey(Buffer.from(process.env.LICENSE_PRIVATE_KEY_B64,'base64').toString('utf8'))
const publicKey=crypto.createPublicKey(Buffer.from(process.env.LICENSE_PUBLIC_KEY_B64,'base64').toString('utf8'))
if(privateKey.asymmetricKeyType!=='ed25519'||publicKey.asymmetricKeyType!=='ed25519') throw new Error('Licence keys must be Ed25519')
const u=new URL(process.env.DATABASE_URL)
const pool=mysql.createPool({host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1),waitForConnections:true,connectionLimit:10,timezone:'Z',ssl:process.env.DB_TLS==='true'?{rejectUnauthorized:true}:undefined})
const app=express()
app.disable('x-powered-by'); app.use(helmet())
app.use(cors({origin:process.env.PORTAL_ORIGIN,methods:['GET','POST'],allowedHeaders:['Content-Type','Authorization']}))
app.use(express.json({limit:'64kb'}))
app.use(rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false}))
const loginLimiter=rateLimit({windowMs:15*60_000,limit:8,standardHeaders:true,legacyHeaders:false})
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next)
const createSchema=z.object({
 institutionName:z.string().trim().min(2).max(190),
 institutionId:z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9_-]+$/),
 contactEmail:z.union([z.string().email().max(190),z.literal('')]).optional(),
 plan:z.enum(['TRIAL','STANDARD','PROFESSIONAL','ENTERPRISE']),
 maxCandidates:z.number().int().min(1).max(100000),
 expiresAt:z.union([z.string().date(),z.null()]).optional(),
 features:z.array(z.enum(['cbt','question-bank','results','excel-export','pdf-export','backup-restore','osce','viva'])).max(20).default(['cbt','question-bank','results','excel-export','pdf-export','backup-restore'])
})
const activationSchema=z.object({activationKey:z.string().trim().min(15).max(100),installationId:z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/)})
function adminAuth(req,res,next){
 const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):''
 try {const d=jwt.verify(token,process.env.JWT_SECRET,{issuer:'cbt-licensing'});if(d.role!=='LICENSING_ADMIN')throw Error();req.admin=d;next()}
 catch {res.status(401).json({message:'Authentication required'})}
}
app.get('/health',(_req,res)=>res.json({status:'ok'}))
app.post('/api/admin/login',loginLimiter,wrap(async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase(), password=String(req.body?.password||'')
 const [emailOk,passwordOk]=[email===process.env.LICENSE_ADMIN_EMAIL.toLowerCase(),await bcrypt.compare(password,process.env.LICENSE_ADMIN_PASSWORD_HASH)]
 if(!emailOk||!passwordOk)return res.status(401).json({message:'Invalid credentials'})
 const token=jwt.sign({sub:email,role:'LICENSING_ADMIN'},process.env.JWT_SECRET,{expiresIn:'30m',issuer:'cbt-licensing'})
 res.json({token,expiresIn:1800,user:{email,role:'LICENSING_ADMIN'}})
}))
app.get('/api/admin/licenses',adminAuth,wrap(async(_req,res)=>{
 const [rows]=await pool.query('SELECT id,institution_id,institution_name,contact_email,plan,status,installation_id,max_candidates,issued_at,expires_at,activated_at,features,created_at FROM licenses ORDER BY created_at DESC LIMIT 1000')
 res.json({data:rows})
}))
app.post('/api/admin/licenses',adminAuth,wrap(async(req,res)=>{
 const parsed=createSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Invalid licence details',errors:parsed.error.flatten()})
 const x=parsed.data, id=crypto.randomUUID(), key=generateActivationKey(), issued=new Date(), expiry=x.expiresAt?new Date(`${x.expiresAt}T23:59:59.999Z`):null
 const [existing]=await pool.execute("SELECT id FROM licenses WHERE institution_id=? AND status IN ('PENDING','ACTIVE') LIMIT 1",[x.institutionId])
 if(existing.length)return res.status(409).json({message:'This institution already has a pending or active licence.'})
 await pool.execute("INSERT INTO licenses (id,institution_id,institution_name,contact_email,plan,status,activation_key_hash,max_candidates,issued_at,expires_at,features) VALUES (?,?,?,?,?,'PENDING',?,?,?,?,?)",
 [id,x.institutionId,x.institutionName,x.contactEmail||null,x.plan,hashKey(key),x.maxCandidates,issued,expiry,JSON.stringify(x.features)])
 res.status(201).json({data:{id,institutionId:x.institutionId,institutionName:x.institutionName,plan:x.plan,maxCandidates:x.maxCandidates,expiresAt:expiry,activationKey:key}})
}))
app.post('/api/admin/licenses/:id/revoke',adminAuth,wrap(async(req,res)=>{
 const [result]=await pool.execute("UPDATE licenses SET status='REVOKED' WHERE id=? AND status <> 'REVOKED'",[req.params.id])
 if(!result.affectedRows)return res.status(404).json({message:'Licence not found or already revoked'})
 res.json({message:'Licence revoked. Offline installations learn about revocation only when they next check in.'})
}))
app.post('/api/public/activate',loginLimiter,wrap(async(req,res)=>{
 const parsed=activationSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Invalid activation request'})
 const {activationKey,installationId}=parsed.data
 const [rows]=await pool.execute('SELECT * FROM licenses WHERE activation_key_hash=? LIMIT 1',[hashKey(activationKey)])
 const row=rows[0];if(!row)return res.status(401).json({message:'Activation key is invalid'})
 if(['REVOKED','EXPIRED'].includes(row.status))return res.status(403).json({message:'Licence is not active'})
 if(row.expires_at&&new Date(row.expires_at).getTime()<Date.now()){await pool.execute("UPDATE licenses SET status='EXPIRED' WHERE id=?",[row.id]);return res.status(403).json({message:'Licence has expired'})}
 if(row.installation_id&&row.installation_id!==installationId)return res.status(409).json({message:'Licence is bound to another installation; contact support for transfer'})
 const signed=buildLicense(row,installationId,privateKey)
 await pool.execute("UPDATE licenses SET status='ACTIVE',installation_id=?,activated_at=COALESCE(activated_at,UTC_TIMESTAMP(3)),signed_license=? WHERE id=?",[installationId,JSON.stringify(signed),row.id])
 res.json({data:signed,publicKey:process.env.LICENSE_PUBLIC_KEY_B64})
}))
app.post('/api/admin/licenses/:id/offline-issue',adminAuth,wrap(async(req,res)=>{
 const installationId=String(req.body?.installationId||'').trim()
 if(!/^[A-Za-z0-9_-]{8,64}$/.test(installationId))return res.status(400).json({message:'A valid Installation ID is required'})
 const [rows]=await pool.execute('SELECT * FROM licenses WHERE id=? LIMIT 1',[req.params.id]), row=rows[0]
 if(!row||['REVOKED','EXPIRED'].includes(row.status))return res.status(404).json({message:'Eligible licence not found'})
 if(row.installation_id&&row.installation_id!==installationId)return res.status(409).json({message:'Licence is already bound to another installation'})
 if(row.expires_at&&new Date(row.expires_at).getTime()<Date.now())return res.status(403).json({message:'Licence has expired'})
 const signed=buildLicense(row,installationId,privateKey)
 await pool.execute("UPDATE licenses SET status='ACTIVE',installation_id=?,activated_at=COALESCE(activated_at,UTC_TIMESTAMP(3)),signed_license=? WHERE id=?",[installationId,JSON.stringify(signed),row.id])
 res.json({data:signed})
}))
app.use((err,_req,res,_next)=>{console.error('Licensing request failed:',err?.message||'unknown error');res.status(500).json({message:'Internal licensing service error'})})
const port=Number(process.env.PORT||8080)
app.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`CBT Licensing Service listening on ${port}`))
