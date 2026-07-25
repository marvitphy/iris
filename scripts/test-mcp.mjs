// Smoke-test the built MCP server over stdio: initialize -> tools/list -> tools/call snapshot.
import { spawn } from 'node:child_process'

const child = spawn('node', ['dist-mcp/iris-mcp.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
const pending = new Map()
child.stdout.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})
const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')
const rpc = (id, method, params) =>
  new Promise((res) => {
    pending.set(id, res)
    send({ jsonrpc: '2.0', id, method, params })
  })

const init = await rpc(1, 'initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
})
console.log('initialize ->', init.result.serverInfo)
send({ jsonrpc: '2.0', method: 'notifications/initialized' })

const tools = await rpc(2, 'tools/list', {})
console.log('tools ->', tools.result.tools.map((t) => t.name).join(', '))

const snap = await rpc(3, 'tools/call', { name: 'snapshot', arguments: {} })
const text = snap.result?.content?.[0]?.text ?? JSON.stringify(snap.result ?? snap.error)
console.log('snapshot tool ->', text.slice(0, 160).replace(/\n/g, ' '))

child.kill()
process.exit(0)
