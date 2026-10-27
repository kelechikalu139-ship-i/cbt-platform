import { createConnection } from 'mariadb'
import bcrypt from 'bcrypt'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

async function readInput() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return JSON.parse(input)
}

const input = await readInput()
const installRoot = path.resolve(input.installRoot)
const serverRoot = path.join(installRoot, 'server')
const nodePath = path.join(installRoot, 'runtime', 'node', 'node.exe')
const prismaCli = path.join(serverRoot, 'node_modules', 'prisma', 'build', 'index.js')
const configPath = path.join(serverRoot, 'prisma.config.ts')
const databasePort = Number(input.databasePort)

if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(input.adminEmail)) throw new Error('Administrator email is invalid')
if (typeof input.adminPassword !== 'string' || input.adminPassword.length < 12) throw new Error('Administrator password must contain at least 12 characters')
if (!/^[a-f0-9]{64}$/i.test(input.databasePassword)) throw new Error('Generated database password is invalid')
if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) throw new Error('Database port is invalid')

let connection
try {
  connection = await createConnection({
    host: '127.0.0.1', port: databasePort, user: 'root', password: input.databaseRootPassword,
    connectTimeout: 10000, multipleStatements: false,
  })
  const [database] = await connection.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='cbt_system'")
  const existingAppUser = await connection.query("SELECT 1 FROM mysql.user WHERE User='cbt_app' AND Host='127.0.0.1' LIMIT 1")
  if (database) {
    const tables = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='cbt_system' LIMIT 1")
    if (tables.length) {
      if (!existingAppUser.length) throw new Error('The cbt_system database already contains data; refusing to install over it')
      const appConnection = await createConnection({
        host: '127.0.0.1', port: databasePort, user: 'cbt_app', password: input.databasePassword,
        database: 'cbt_system', connectTimeout: 10000,
      })
      try {
        const [migrationTable] = await appConnection.query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='prisma_migrations'")
        if (!migrationTable) throw new Error('The cbt_system database is non-empty and is not an incomplete CBT installation')
      } finally { await appConnection.end() }
    }
  } else {
    await connection.query('CREATE DATABASE `cbt_system` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  }

  if (existingAppUser.length) {
    const appConnection = await createConnection({
      host: '127.0.0.1', port: databasePort, user: 'cbt_app', password: input.databasePassword,
      database: 'cbt_system', connectTimeout: 10000,
    })
    await appConnection.end()
  } else {
    await connection.query(`CREATE USER 'cbt_app'@'127.0.0.1' IDENTIFIED BY ${connection.escape(input.databasePassword)}`)
    await connection.query("GRANT ALL PRIVILEGES ON `cbt_system`.* TO 'cbt_app'@'127.0.0.1'")
  }
} finally {
  if (connection) await connection.end()
}

const migration = spawnSync(nodePath, [prismaCli, 'migrate', 'deploy', '--config', configPath], {
  cwd: input.configDirectory,
  env: process.env,
  encoding: 'utf8',
  windowsHide: true,
})
if (migration.stdout) process.stdout.write(migration.stdout)
if (migration.stderr) process.stderr.write(migration.stderr)
if (migration.status !== 0) throw new Error(`Database migrations failed with exit code ${migration.status ?? 'unknown'}`)

const { prisma } = await import(pathToFileURL(path.join(serverRoot, 'dist', 'config', 'database.js')))
const { ALL_PERMISSION_KEYS, PERMISSION_DESCRIPTIONS, ROLE_DEFINITIONS } = await import(
  pathToFileURL(path.join(serverRoot, 'dist', 'constants', 'permissions.js'))
)
try {
  const currentUsers = await prisma.user.findMany({ select: { email: true, role: { select: { code: true } } } })
  if (currentUsers.length && !(currentUsers.length === 1 && currentUsers[0].email === input.adminEmail.trim().toLowerCase() && currentUsers[0].role.code === 'SUPER_ADMIN')) {
    throw new Error('The database already contains user accounts; first-admin setup is closed')
  }
  const permissionIds = new Map()
  for (const key of ALL_PERMISSION_KEYS) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { description: PERMISSION_DESCRIPTIONS[key], resource: key.split('.')[0] ?? 'system' },
      create: { key, description: PERMISSION_DESCRIPTIONS[key], resource: key.split('.')[0] ?? 'system' },
      select: { id: true },
    })
    permissionIds.set(key, permission.id)
  }

  const roleIds = new Map()
  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: definition.code },
      update: { name: definition.name, description: definition.description, isSystem: true },
      create: { code: definition.code, name: definition.name, description: definition.description, isSystem: true },
      select: { id: true },
    })
    roleIds.set(definition.code, role.id)
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
    const grants = definition.permissions.map((key) => permissionIds.get(key)).filter(Boolean)
    if (grants.length) await prisma.rolePermission.createMany({ data: grants.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true })
  }

  if (!currentUsers.length) {
    const passwordHash = await bcrypt.hash(input.adminPassword, 12)
    await prisma.user.create({
      data: {
        email: input.adminEmail.trim().toLowerCase(),
        passwordHash,
        firstName: input.adminFirstName.trim(),
        lastName: input.adminLastName.trim(),
        status: 'ACTIVE',
        roleId: roleIds.get('SUPER_ADMIN'),
      },
    })
  }
  console.log(`Initial administrator created: ${input.adminEmail.trim().toLowerCase()}`)
} finally {
  await prisma.$disconnect()
}
