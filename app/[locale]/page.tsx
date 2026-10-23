import type { Metadata } from 'next'
import { Archivo, Hanken_Grotesk, Instrument_Serif, JetBrains_Mono } from 'next/font/google'
import { setRequestLocale } from 'next-intl/server'
import BeforeAfter from '@/components/landing/BeforeAfter'
import DemoForm from '@/components/landing/DemoForm'
import ResultShot from '@/components/landing/ResultShot'
import WordScroller from '@/components/landing/WordScroller'
import { STUDIO_URL, WHATSAPP_DISPLAY, whatsappLink } from '@/lib/contact'
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

const TOOLS = ['D5 Render', 'Enscape', '3ds Max', 'V-Ray', 'Corona']

const DEMO_TEXT ='Bonjour, je souhaite une démo de Roomia Render.'

const RESULTS = [
  { name: 'sejour', caption: 'Séjour ouvert sur la cuisine' },
  { name: 'chambre', caption: 'Chambre parentale, marbre' },
  { name: 'salon', caption: 'Salon, habillage bois' },
  { name: 'nuit', caption: 'Salon, ambiance de nuit' },
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
            <a href="#resultats">Résultats</a>
            <a href="#etapes">Comment ça marche</a>
            <a href="#pour-qui">Pour qui</a>
            <a href="#offres">Offres</a>
          </nav>
          <a className="btn btn-main" href="#demo">
            Demander une démo
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero band" id="temps">
          <div className="wrap">
            <h1 className="sr-only">Roomia Render : de votre fichier SketchUp à la photo réaliste en 3 minutes</h1>
            <div className="vs2">
              <div className="card old">
                <WordScroller words={TOOLS} label="Logiciels de rendu" />
                <p className="unit">Lumières, matériaux, calcul, retouches : à régler pour chaque vue.</p>
              </div>
              <div className="vsmark" aria-hidden="true">
                VS
              </div>
              <div className="card new">
                <div className="brand">
                  ROOMIA<span>.</span>
                </div>
                <p className="unit">Votre fichier SketchUp, une vue, une photo. Aucun réglage.</p>
              </div>
            </div>
            <div className="times" role="group" aria-label="Temps par vue">
              <div className="side old">
                <div className="num">≈ 2 h</div>
                <div className="cap">par vue avec un logiciel</div>
              </div>
              <div className="arrow" aria-hidden="true">
                →
              </div>
              <div className="side new">
                <div className="num">3 min</div>
                <div className="cap">par vue avec Roomia</div>
              </div>
            </div>
            <div className="hero-row">
              <p className="lede">
                Chaque vue de votre projet SketchUp devient une <strong>photo réaliste</strong>, sans réglages ni attente. Vos matériaux, vos meubles, votre cadrage : le design reste le vôtre.
              </p>
              <div className="ctas">
                <a className="btn btn-main" href={STUDIO_URL}>
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
          </div>
        </section>

        <section className="versus band">
          <div className="wrap">
            <div className="head">
              <h2>
                10 vues : <em>20 heures</em> ou 30 minutes
              </h2>
            </div>
            <div className="bars" role="group" aria-label="Un appartement de 10 vues">
              <h3>Un appartement, 10 vues à présenter</h3>
              <div className="bar old">
                <span>Avec un logiciel</span>
                <div className="track">
                  <div className="fill" />
                </div>
                <span className="val">≈ 20 h</span>
              </div>
              <div className="bar new">
                <span>Avec Roomia</span>
                <div className="track">
                  <div className="fill" />
                </div>
                <span className="val">≈ 30 min</span>
              </div>
            </div>
            <p className="note">
              Ces logiciels restent les outils pour modéliser et pour les projets sur mesure. Roomia prend en charge l’étape du rendu. Temps avec logiciel : 1 h 30 à 2 h par vue, relevé par une architecte d’intérieur en poste (il varie selon le projet et la machine). Roomia : 2 à 5 minutes par vue sur nos rendus réels, 3 minutes en moyenne.
            </p>
          </div>
        </section>

        <section className="section band" id="resultats">
          <div className="wrap">
            <div className="head">
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

        <section className="section band" id="etapes">
          <div className="wrap">
            <div className="head">
              <h2>
                Trois étapes, <em>aucun réglage</em>
              </h2>
              <p className="lede">Pas besoin de refaire le projet ni d’avoir un ordinateur puissant. Tout se passe dans le navigateur.</p>
            </div>
            <ol className="steps">
              <li>
                <span className="n">1</span>
                <h3>Importez votre modèle</h3>
                <p>Exportez votre projet SketchUp en GLB ou DAE et déposez-le dans Roomia. Les gros fichiers (jusqu’à 500 Mo) passent aussi.</p>
              </li>
              <li>
                <span className="n">2</span>
                <h3>Choisissez la vue</h3>
                <p>Vos scènes enregistrées sont reprises telles quelles. Vérifiez le cadrage en un clic, gratuitement.</p>
              </li>
              <li>
                <span className="n">3</span>
                <h3>Recevez la photo</h3>
                <p>Lumière du jour, du soir ou de nuit. La photo est prête à montrer au client.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section band" id="fidelite">
          <div className="wrap fidelity">
            <div className="head">
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
              <h2>
                Payé en <em>dinars</em>, sans carte étrangère
              </h2>
            </div>
            <div className="offers">
              <article>
                <h3>Démo</h3>
                <p>On rend une de vos vues, sur votre propre projet, devant vous.</p>
                <ul>
                  <li>Gratuite</li>
                  <li>Votre fichier, vos scènes</li>
                </ul>
              </article>
              <article className="main">
                <h3>Abonnement mensuel</h3>
                <p>Pour les bureaux et les promoteurs : un forfait par mois pour toute l’équipe, avec un volume de rendus défini et un support direct.</p>
                <ul>
                  <li>Plusieurs comptes</li>
                  <li>File prioritaire</li>
                  <li>Accompagnement sur vos projets</li>
                </ul>
              </article>
              <article>
                <h3>À la photo</h3>
                <p>Pour les indépendants : vous payez les photos que vous générez. Une photo ratée n’est pas comptée.</p>
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
