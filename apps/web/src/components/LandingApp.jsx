import Nav from './Nav.jsx'
import Footer from './Footer.jsx'
import Hero from './Hero.jsx'
import { WhyNShroud, HowItWorks, Features, SecurityPosture } from './SectionsA.jsx'
import { Architecture, Pricing, ChangelogTeaser, FinalCTA } from './SectionsB.jsx'

export default function LandingApp({ releases = [] }) {
  const navVersion = releases[0]?.version ? `v${releases[0].version}` : 'v0.5.1'
  return (
    <>
      <Nav active="home" changelogVersion={navVersion} />
      <Hero grid />
      <WhyNShroud />
      <HowItWorks />
      <Features />
      <SecurityPosture />
      <Architecture />
      <Pricing />
      <ChangelogTeaser releases={releases} />
      <FinalCTA />
      <Footer />
    </>
  )
}
