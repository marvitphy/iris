import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

mkdirSync('build', { recursive: true })

const iconSvg = readFileSync('assets/icon.svg')
const markSvg = readFileSync('assets/mark.svg')

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const pngs = {}
for (const s of sizes) {
  const buf = await sharp(iconSvg).resize(s, s).png().toBuffer()
  writeFileSync(`build/icon-${s}.png`, buf)
  pngs[s] = buf
}

// Windows .ico (multi-size) for the exe + window
const ico = await pngToIco([pngs[16], pngs[24], pngs[32], pngs[48], pngs[64], pngs[128], pngs[256]])
writeFileSync('build/icon.ico', ico)

// square PNG for electron-builder (mac/linux) + general use
writeFileSync('build/icon.png', pngs[512])

// transparent symbol for in-app use
writeFileSync('build/mark-512.png', await sharp(markSvg).resize(512, 512).png().toBuffer())
writeFileSync('build/mark-64.png', await sharp(markSvg).resize(64, 64).png().toBuffer())

console.log('icons built -> build/icon.ico, build/icon.png, build/mark-*.png')
