import Nav from './Nav.jsx'
import Footer from './Footer.jsx'
import ChangelogPage from './ChangelogPage.jsx'
import { useLiveChangelog } from '../lib/useLiveChangelog.ts'

export default function ChangelogApp({ releases: initial = [] }) {
  const releases = useLiveChangelog(initial)
  const navVersion = releases[0]?.version ? `v${releases[0].version}` : 'v0.5.1'
  return (
    <>
      <Nav active="changelog" changelogVersion={navVersion} />
      <ChangelogPage releases={releases} />
      <Footer />
    </>
  )
}
