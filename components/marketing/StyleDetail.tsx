import Image from 'next/image'
import type { StyleVisual } from '@/lib/style-details'

type Labels = {
  palette: string
  materials: string
  traits: string
  photoLiving: string
  photoBedroom: string
  photoKitchen: string
}

function SwatchRow({
  items,
  kind,
}: {
  items: string[]
  kind: 'color' | 'material'
}) {
  return (
    <div className="rm-style-swatches">
      {items.map((item, index) =>
        kind === 'color' ? (
          <div
            key={`${item}-${index}`}
            className="rm-style-swatch"
            style={{ background: item }}
          />
        ) : (
          <div key={`${item}-${index}`} className="rm-style-swatch">
            <Image src={item} alt="" fill sizes="140px" className="object-cover" />
          </div>
        ),
      )}
    </div>
  )
}

export default function StyleDetail({
  name,
  visual,
  traits,
  labels,
}: {
  name: string
  visual: StyleVisual
  traits: string[]
  labels: Labels
}) {
  const photos = [
    { src: visual.photos.living, label: labels.photoLiving },
    { src: visual.photos.bedroom, label: labels.photoBedroom },
    { src: visual.photos.kitchen, label: labels.photoKitchen },
  ]

  return (
    <section className="rm-style-detail">
      <div className="mx-auto max-w-[92rem] px-6 py-10 md:px-10 md:py-14">
        <h1 className="rm-display text-center text-4xl font-bold tracking-tight text-white md:text-5xl lg:text-6xl">
          {name}
        </h1>

        <div className="rm-style-detail-grid mt-12 md:mt-16">
          <div className="rm-style-detail-palette">
            <SwatchRow items={visual.palette} kind="color" />
            <p className="rm-style-detail-caption">{labels.palette}</p>
          </div>

          <div className="rm-style-detail-materials">
            <SwatchRow items={visual.materials} kind="material" />
            <p className="rm-style-detail-caption">{labels.materials}</p>
          </div>

          <div className="rm-style-detail-traits">
            <h2 className="rm-style-detail-heading">{labels.traits}</h2>
            <ul className="rm-style-traits">
              {traits.map(trait => (
                <li key={trait}>{trait}</li>
              ))}
            </ul>
          </div>

          <div className="rm-style-detail-photos">
            {photos.map(photo => (
              <figure key={photo.src} className="rm-style-photo">
                <Image
                  src={photo.src}
                  alt={`${name} — ${photo.label}`}
                  fill
                  sizes="(max-width: 1024px) 100vw, 38vw"
                  className="object-cover"
                />
                <figcaption>{photo.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
