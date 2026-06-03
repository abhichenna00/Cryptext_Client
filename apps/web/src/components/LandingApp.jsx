import Nav from './Nav.jsx'
import Footer from './Footer.jsx'
import Hero from './Hero.jsx'
import { WhyNShroud, HowItWorks, Features } from './SectionsA.jsx'
import { Pricing, ChangelogTeaser, FinalCTA } from './SectionsB.jsx'
import { useLiveChangelog } from '../lib/useLiveChangelog.ts'

export default function LandingApp({ releases: initial = [] }) {
  const releases = useLiveChangelog(initial)
  const navVersion = releases[0]?.version ? `v${releases[0].version}` : 'v0.5.1'
  return (
    <>
      <Nav active="home" changelogVersion={navVersion} />
      <Hero grid />
      <WhyNShroud />
      <Features />
      <HowItWorks />
      <Pricing />
      <ChangelogTeaser releases={releases} />
      <FinalCTA />
      <Footer />
    </>
  )
}
