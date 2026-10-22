import type { Metadata } from 'next'
import { Archivo, Hanken_Grotesk, Instrument_Serif, JetBrains_Mono } from 'next/font/google'
import { setRequestLocale } from 'next-intl/server'
import BeforeAfter from '@/components/landing/BeforeAfter'
import DemoForm from '@/components/landing/DemoForm'
import ResultShot from '@/components/landing/ResultShot'
import { WHATSAPP_DISPLAY, whatsappLink } from '@/lib/contact'
import './landing.css'

// The previous home page (the interior configurator) is kept in ./_ancienne-accueil, out of routing.

const display = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--rl-display', display: 'swap' })
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--rl-serif', display: 'swap' })
const body = Hanken_Grotesk({ subsets: ['latin'], variable: '--rl-body', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--rl-mono', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL('https://www.room-ia.com'),
  title: 'Roomia Render · De votre 3D à la photo en quelques minutes',
  description:
    'Transformez vos scènes SketchUp en photos réalistes en quelques minutes, fidèles à votre design. Pour promoteurs, bureaux d’architecture, architectes d’intérieur et cuisinistes.',
  openGraph: {
    title: 'Roomia Render · De votre 3D à la photo',
    description: 'Le rendu qui prenait 2 heures par vue sort en quelques minutes, directement depuis votre fichier SketchUp.',
    images: [{ url: '/landing/hero-photo.jpg', width: 1600, height: 1067 }],
    locale: 'fr_DZ',
    type: 'website',
  },
}

const DEMO_TEXT = 'Bonjour, je souhaite une démo de Roomia Render.'

const RESULTS = [
  { name: 'sejour', caption: 'Séjour ouvert sur la cuisine', light: 'Jour' },
  { name: 'chambre', caption: 'Chambre parentale, marbre', light: 'Soir' },
  { name: 'salon', caption: 'Salon, habillage bois', light: 'Soir' },
  { name: 'nuit', caption: 'Salon, ambiance de nuit', light: 'Nuit' },
]

const KEEPS = [
  ['Votre cadrage exact', 'La photo reprend la scène enregistrée dans SketchUp, au même angle et au même objectif.'],
  ['Vos matériaux et vos couleurs', 'Le bois reste ce bois, le marbre reste ce marbre.'],
  ['Vos meubles, à leur place', 'Rien n’est ajouté, retiré ou déplacé.'],
  ['Vraies vitres, vrais miroirs', 'Les miroirs reflètent la pièce, nets. Les vitres laissent voir l’extérieur.'],
  ['Une correction en un clic', 'Un matériau mal reconnu ? Indiquez-le (miroir, verre, lumière) et relancez la photo.'],
]

const FAQ = [
  ['Quels fichiers puis-je utiliser ?', 'Un modèle exporté depuis SketchUp en GLB ou en DAE, avec ses scènes enregistrées. Les projets lourds, jusqu’à environ 500 Mo, sont acceptés.'],
  ['Combien de temps prend une photo ?', 'Entre 2 et 5 minutes selon la taille du projet, 3 minutes en moyenne sur nos rendus réels. Si vous avez déjà vérifié la vue, moins d’une minute.'],
  ['Faut-il un ordinateur puissant ?', 'Non. Le calcul se fait chez Roomia. Il suffit d’un navigateur.'],
  ['Et si la photo ne respecte pas mon design ?', 'Vous pouvez corriger un matériau et relancer. Une photo qui change clairement votre design est examinée et n’est pas facturée.'],
]

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div className={`rl ${display.variable} ${serif.variable} ${body.variable} ${mono.variable}`} lang="fr">
      <header className="top band">
        <div className="wrap">
          <a className="logo" href="#top">
            ROOMIA<span>.</span>
          </a>
          <nav aria-label="Sections">
            <a href="#temps">Le temps gagné</a>
            <a href="#etapes">Comment ça marche</a>
            <a href="#resultats">Résultats</a>
            <a href="#pour-qui">Pour qui</a>
            <a href="#offres">Offres</a>
          </nav>
          <a className="btn btn-main" href="#demo">
            Demander une démo
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero band">
          <div className="wrap">
            <p className="eyebrow">Roomia Render · pour promoteurs, architectes et designers</p>
            <h1>
              De votre 3D
              <br />à la <em>photo</em>
            </h1>
            <div className="hero-row">
              <p className="lede">
                Le rendu qui vous prenait <strong>1 h 30 à 2 heures par vue</strong> sort en <strong>quelques minutes</strong>, directement depuis votre fichier SketchUp. Vos matériaux, vos meubles, votre cadrage : le design reste le vôtre.
              </p>
              <div className="ctas">
                <a className="btn btn-main" href="#demo">
                  Tester sur mon projet
                </a>
                <a className="btn btn-ghost" href="#resultats">
                  Voir les résultats
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="wipe-band band" aria-label="Avant et après">
          <div className="wrap">
            <BeforeAfter
              before="/landing/hero-3d.jpg"
              after="/landing/hero-photo.jpg"
              beforeAlt="Capture de la scène 3D SketchUp d’une salle à manger, sans éclairage réaliste"
              afterAlt="La même salle à manger rendue en photo réaliste par Roomia, lumière de fin de journée"
            />
            <div className="wipe-meta">
              <span>Appartement F5 · séjour et salle à manger · projet réel</span>
              <span>Même cadrage, mêmes meubles, mêmes matériaux</span>
            </div>
          </div>
        </section>

        <section className="time band" id="temps">
          <div className="ghost" aria-hidden="true">
            RENDU
          </div>
          <div className="wrap">
            <div className="head">
              <p className="eyebrow">Le temps gagné</p>
              <h2>
                Vous achetez <em>du temps</em>
              </h2>
            </div>
            <div className="vs">
              <div className="side old">
                <div className="num">2 h</div>
                <div className="unit">Rendu classique, par vue</div>
              </div>
              <div className="arrow" aria-hidden="true">
                →
              </div>
              <div className="side new">
                <div className="num">3 min</div>
                <div className="unit">Roomia, par vue (moyenne mesurée)</div>
              </div>
            </div>
            <div className="bars" role="group" aria-label="Un appartement de 10 vues">
              <h3>Un appartement, 10 vues à présenter</h3>
              <div className="bar old">
                <span>Rendu classique</span>
                <div className="track">
                  <div className="fill" />
                </div>
                <span className="val">≈ 20 h</span>
              </div>
              <div className="bar new">
                <span>Roomia</span>
                <div className="track">
                  <div className="fill" />
                </div>
                <span className="val">≈ 30 min</span>
              </div>
              <p className="note">
                Barres à l’échelle. Rendu classique : 1 h 30 à 2 h par vue selon une architecte d’intérieur en poste. Roomia : 2 à 5 minutes par vue sur nos rendus de projets réels, 3 minutes en moyenne.
              </p>
            </div>
          </div>
        </section>

        <section className="section band" id="etapes">
          <div className="wrap">
            <div className="head">
              <p className="eyebrow">Comment ça marche</p>
              <h2>
                Gardez votre <em>logiciel</em>. On s’occupe du rendu.
              </h2>
              <p className="lede">Pas besoin de refaire le projet ni d’avoir un ordinateur puissant. Tout se passe dans le navigateur.</p>
            </div>
            <ol className="steps">
              <li>
                <span className="n">1</span>
                <h3>Importez votre modèle</h3>
                <p>Exportez votre projet SketchUp et déposez-le dans Roomia. Les gros fichiers passent aussi.</p>
                <span className="fmt">GLB · DAE · jusqu’à ~500 Mo</span>
              </li>
              <li>
                <span className="n">2</span>
                <h3>Choisissez la vue</h3>
                <p>Vos scènes enregistrées sont reprises telles quelles. Vérifiez le cadrage en un clic, gratuitement.</p>
                <span className="fmt">Vos scènes · votre objectif</span>
              </li>
              <li>
                <span className="n">3</span>
                <h3>Recevez la photo</h3>
                <p>Lumière du jour, du soir ou de nuit. La photo est prête à montrer au client.</p>
                <span className="fmt">≈ 3 min · haute définition</span>
              </li>
            </ol>
          </div>
        </section>

        <section className="section band" id="resultats">
          <div className="wrap">
            <div className="head">
              <p className="eyebrow">Résultats</p>
              <h2>
                Le même projet, <em>en vrai</em>
              </h2>
              <p className="lede">Des projets réels d’appartements. Passez la souris sur une photo, ou touchez « Voir la 3D », pour retrouver la scène d’origine.</p>
            </div>
            <div className="gallery">
              {RESULTS.map(r => (
                <ResultShot key={r.name} {...r} />
              ))}
            </div>
          </div>
        </section>

        <section className="section band" id="fidelite">
          <div className="wrap fidelity">
            <div className="head">
              <p className="eyebrow">Fidèle à votre design</p>
              <h2>
                Une belle image ne suffit pas. Elle doit être <em>la vôtre</em>.
              </h2>
              <p className="lede">Roomia part de votre fichier complet, pas d’une capture d’écran. Ce que vous avez dessiné reste à sa place.</p>
              <div className="scan">
                <h3>Rien n’est inventé derrière la porte vitrée.</h3>
                <p>Avant de générer, Roomia regarde autour de la caméra : balcon, ciel, pièce voisine. Ce qu’on voit à travers une vitre vient de votre projet, pas de l’imagination de l’IA.</p>
              </div>
            </div>
            <ul className="keeps">
              {KEEPS.map(([title, text]) => (
                <li key={title}>
                  <span className="dot" />
                  <div>
                    <strong>{title}</strong>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section band" id="pour-qui">
          <div className="wrap">
            <div className="head">
              <p className="eyebrow">Pour qui</p>
              <h2>
                Pour ceux qui doivent <em>montrer</em> avant de construire
              </h2>
            </div>
            <div className="who">
              <article className="lead">
                <h3>Promoteurs immobiliers</h3>
                <p>Toutes les typologies de votre programme en visuels réalistes pour la vente sur plan : brochure, site, bureau de vente. Quand le plan change, les visuels suivent le jour même.</p>
                <div className="chips">
                  {['F2', 'F3', 'F4', 'F5', 'Duplex', 'Parties communes'].map(c => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </article>
              <article>
                <h3>Bureaux d’architecture</h3>
                <p>Le rendu ne bloque plus une personne pendant des semaines. Refaire les visuels de tout un projet devient l’affaire d’une journée.</p>
              </article>
              <article>
                <h3>Architectes d’intérieur</h3>
                <p>Montrez au client son espace comme il sera, dès la première présentation, sans attendre le rendu.</p>
              </article>
              <article>
                <h3>Cuisinistes</h3>
                <p>Montrez la cuisine finie avant la signature, sans faire de rendu vous-même.</p>
              </article>
              <article>
                <h3>Designers indépendants</h3>
                <p>Un rendu professionnel sans logiciel de rendu ni carte graphique puissante.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section band" id="offres">
          <div className="wrap">
            <div className="head">
              <p className="eyebrow">Offres</p>
              <h2>
                Payé en <em>dinars</em>, sans carte étrangère
              </h2>
            </div>
            <div className="offers">
              <article>
                <span className="kind">Pour commencer</span>
                <h3>Démo</h3>
                <p>On rend une de vos vues, sur votre propre projet, devant vous.</p>
                <ul>
                  <li>Gratuite</li>
                  <li>Votre fichier, vos scènes</li>
                </ul>
              </article>
              <article className="main">
                <span className="kind">Bureaux et promoteurs</span>
                <h3>Abonnement mensuel</h3>
                <p>Un forfait par mois pour toute l’équipe, avec un volume de rendus défini et un support direct.</p>
                <ul>
                  <li>Plusieurs comptes</li>
                  <li>File prioritaire</li>
                  <li>Accompagnement sur vos projets</li>
                </ul>
              </article>
              <article>
                <span className="kind">Indépendants</span>
                <h3>À la photo</h3>
                <p>Vous payez les photos que vous générez. Une photo ratée n’est pas comptée.</p>
                <ul>
                  <li>Sans engagement</li>
                  <li>Vérification de la vue gratuite</li>
                </ul>
              </article>
            </div>
            <p className="note">Tarifs en dinars, paiement local (BaridiMob, CCP). Détails lors de la démo.</p>
          </div>
        </section>

        <section className="section band" id="questions">
          <div className="wrap">
            <div className="head">
              <p className="eyebrow">Questions</p>
              <h2>
                Les questions qu’on nous <em>pose</em>
              </h2>
            </div>
            <div className="faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="demo band" id="demo">
          <div className="wrap">
            <div className="head">
              <p className="eyebrow">Démo</p>
              <h2>
                Testez Roomia sur <em>votre</em> projet
              </h2>
              <p className="lede">Laissez-nous vos coordonnées. On rend une de vos vues en quelques minutes, devant vous.</p>
              <div className="whatsapp">
                <a className="btn btn-ghost" href={whatsappLink(DEMO_TEXT)} target="_blank" rel="noopener noreferrer">
                  Écrire sur WhatsApp
                </a>
                <span className="num">{WHATSAPP_DISPLAY}</span>
              </div>
            </div>
            <DemoForm />
          </div>
        </section>
      </main>

      <footer className="band">
        <div className="wrap">
          <span>Roomia · room-ia.com</span>
          <span>Rendus réalistes à partir de vos modèles 3D</span>
        </div>
      </footer>
    </div>
  )
}
