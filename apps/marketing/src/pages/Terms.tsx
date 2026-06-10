import { terms } from '~/content/legal'
import { seo } from '~/content/site'
import { LegalPage } from './LegalPage'

export function Terms() {
    return <LegalPage meta={seo['/terms']} document={terms} />
}
