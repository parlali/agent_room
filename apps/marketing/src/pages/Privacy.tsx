import { privacy } from '~/content/legal'
import { seo } from '~/content/site'
import { LegalPage } from './LegalPage'

export function Privacy() {
    return <LegalPage meta={seo['/privacy']} document={privacy} />
}
