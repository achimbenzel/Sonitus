/* About window: app info, version placeholder and license overview.
   License texts for the bundled fonts live in src/assets/fonts/. */

import { Modal } from '../ui/Modal'
import logoUrl from '../../assets/sonitos-logo-placeholder.svg'
import pkg from '../../../package.json'

interface AboutModalProps {
  onClose: () => void
}

const THIRD_PARTY = [
  { name: 'react / react-dom', license: 'MIT', role: 'UI framework' },
  { name: 'fflate', license: 'MIT', role: 'ZIP creation for sequence export' },
  { name: 'lucide-react', license: 'ISC', role: 'Icon set (bundled locally)' },
  { name: 'vite', license: 'MIT', role: 'Build tool (dev dependency)' },
  { name: 'typescript', license: 'Apache-2.0', role: 'Compiler (dev dependency)' },
]

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <Modal title="About" onClose={onClose} wide>
      <div className="about-head">
        <img src={logoUrl} alt="" className="about-logo" />
        <div>
          <h3 className="about-name">Sonitus — Dither Studio</h3>
          <p className="about-version">Version {pkg.version} (placeholder)</p>
        </div>
      </div>
      <p className="modal-note">
        A professional, fully offline image dithering studio for single images, image
        sequences and MP4 video frames. All processing happens locally in your browser —
        nothing is uploaded anywhere.
      </p>

      <h4 className="modal-subhead">App license</h4>
      <p className="modal-note">
        [PLACEHOLDER — insert the final Sonitus application license text here. No license
        is claimed for the application code until this is filled in.]
      </p>

      <h4 className="modal-subhead">Third-party libraries</h4>
      <table className="about-table">
        <thead>
          <tr>
            <th>Library</th>
            <th>License</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          {THIRD_PARTY.map((d) => (
            <tr key={d.name}>
              <td>{d.name}</td>
              <td>{d.license}</td>
              <td>{d.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="modal-note">
        Full license texts ship with each package in <code>node_modules</code>.
      </p>

      <h4 className="modal-subhead">Icons</h4>
      <p className="modal-note">
        Lucide icons — © Lucide Contributors, ISC License. Bundled locally via the
        <code> lucide-react</code> package; no icons are loaded from the internet.
      </p>

      <h4 className="modal-subhead">Fonts</h4>
      <p className="modal-note">
        DM Sans — © The DM Sans Project Authors, SIL Open Font License 1.1.<br />
        JetBrains Mono — © JetBrains, SIL Open Font License 1.1.<br />
        Both families are bundled in <code>src/assets/fonts/</code> together with their
        OFL license texts (<code>OFL-DMSans.txt</code>, <code>OFL-JetBrainsMono.txt</code>).
      </p>
    </Modal>
  )
}
