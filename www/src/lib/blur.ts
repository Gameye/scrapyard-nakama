import { join } from 'node:path'
import type { ImageMetadata } from 'astro'
import sharp from 'sharp'

// Every image under src/assets, by path: how a placeholder finds the file
// behind an imported image (the import itself carries only its URL).
const files = import.meta.glob<ImageMetadata>('/src/assets/**/*.{jpg,jpeg,png,webp}', { eager: true, import: 'default' })

// The blur-up placeholder next/image drew, rebuilt at build time: the image
// shrunk to 8 px wide, blurred by an SVG filter, as a background that shows
// while the real image loads. Returns the inline style for the <img>.
export async function blurStyle(image: ImageMetadata) {
  const path = Object.keys(files).find((key) => files[key].src === image.src)
  if (!path) throw new Error(`blurStyle: ${image.src} is not under src/assets`)
  const tiny = await sharp(join(process.cwd(), path)).resize(8).jpeg({ quality: 70 }).toBuffer()
  const high = Math.max(1, Math.round((8 * image.height) / image.width))
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 ${high * 40}'><filter id='b' color-interpolation-filters='sRGB'>` +
    `<feGaussianBlur stdDeviation='20'/><feColorMatrix values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 100 -1' result='s'/>` +
    `<feFlood x='0' y='0' width='100%' height='100%'/><feComposite operator='out' in='s'/><feComposite in2='SourceGraphic'/>` +
    `<feGaussianBlur stdDeviation='20'/></filter><image width='100%' height='100%' x='0' y='0' preserveAspectRatio='none' ` +
    `style='filter: url(#b);' href='data:image/jpeg;base64,${tiny.toString('base64')}'/></svg>`
  const background = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`
  return `color:transparent;background-size:cover;background-position:50% 50%;background-repeat:no-repeat;background-image:${background}`
}
