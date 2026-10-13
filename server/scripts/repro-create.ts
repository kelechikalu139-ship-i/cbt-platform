// Reproduce the exact payload the Add Student modal sends,
// to see the real server error.
const base = 'http://localhost:5000/api/v1'

async function main() {
  // Login
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@cbt.local', password: 'Admin@12345' }),
  })
  const loginData = await login.json()
  const token = loginData?.data?.accessToken
  console.log('LOGIN:', login.status, 'token:', Boolean(token))

  // Exact payload the modal sends
  const payload = {
    studentId: 'TEST/2026/0001',
    firstName: 'Adaeze',
    lastName: 'Okonkwo',
    email: 'a.okonkwo@student.school.local',
    program: 'Computer Science',
    department: 'Science',
    level: 100,
    semester: 1,
    className: 'CSC 100 - A',
    gender: 'Female',
    status: 'ACTIVE',
  }

  const res = await fetch(base + '/students', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  console.log('CREATE status:', res.status)
  console.log('CREATE body:', JSON.stringify(body, null, 2))

  // If created, clean up
  if (body?.data?.id) {
    const del = await fetch(base + '/students/' + body.data.id, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    console.log('CLEANUP DELETE:', del.status)
  }
}

main().catch(console.error)