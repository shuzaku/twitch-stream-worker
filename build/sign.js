/**
 * Post-build signing script.
 * Calls signtool.exe from the local Windows SDK directly, bypassing
 * electron-builder's winCodeSign toolchain (which fails on Windows
 * without Developer Mode or admin rights).
 *
 * Usage:
 *   node build/sign.js                  ← signs release/win-unpacked/*.exe
 *   node build/sign.js --installer      ← also signs release/*.exe (NSIS installer)
 *
 * To use an EV cert instead of the self-signed one:
 *   set CSC_LINK=path\to\cert.pfx
 *   set CSC_KEY_PASSWORD=your-password
 *   node build/sign.js
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const SIGNTOOL =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\Shared\\NuGetPackages\\' +
  'microsoft.windows.sdk.buildtools\\10.0.22621.756\\bin\\10.0.22621.0\\x64\\signtool.exe'

const CERT_PATH = process.env.CSC_LINK
  ? path.resolve(process.env.CSC_LINK)
  : path.join(__dirname, 'cert.pfx')

const CERT_PASSWORD = process.env.CSC_KEY_PASSWORD || 'fightersedge2026'

const RELEASE_DIR = path.join(__dirname, '..', 'dist-release')
const UNPACKED_DIR = path.join(RELEASE_DIR, 'win-unpacked')

const signInstaller = process.argv.includes('--installer')

function findExes(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.exe'))
    .map((f) => path.join(dir, f))
}

function sign(filePath) {
  console.log(`Signing: ${path.basename(filePath)}`)
  execFileSync(SIGNTOOL, [
    'sign',
    '/fd', 'sha256',
    '/f', CERT_PATH,
    '/p', CERT_PASSWORD,
    '/d', 'FGC Loops',
    filePath,
  ], { stdio: 'inherit' })
}

const targets = [
  ...findExes(UNPACKED_DIR),
  ...(signInstaller ? findExes(RELEASE_DIR) : []),
]

if (targets.length === 0) {
  console.error('No .exe files found. Run electron:pack or electron:dist first.')
  process.exit(1)
}

for (const target of targets) {
  sign(target)
}

console.log(`\nSigned ${targets.length} file(s) successfully.`)
