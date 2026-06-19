import { bootstrapRootUser } from '../src/server/auth/auth-service'
import { getAppEnv } from '../src/server/config/env'
import { closeDatabase } from '../src/server/db/client'

async function main() {
    const result = await bootstrapRootUser()
    if (result.created) {
        console.log(`Root user created: ${result.email}`)
        console.log(`Root password is stored in ${getAppEnv().dataDir}/system/bootstrap.json`)
    } else {
        console.log('Root user already exists')
    }
    await closeDatabase()
}

main().catch(async (error) => {
    console.error(error)
    await closeDatabase()
    process.exit(1)
})
