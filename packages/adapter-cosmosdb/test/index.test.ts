import { runBasicTests } from "utils/adapter"
import { CosmosClient } from "@azure/cosmos"
import { CosmosAdapter } from "../src"
import type { AdapterUser, VerificationToken } from "@auth/core/adapters"

const testAccount = {
  endpoint: "https://localhost:8081",
  key: "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
  databaseId: "authTest",
}

const containers = {
  user: "users",
  account: "accounts", 
  session: "sessions",
  verificationToken: "verification_tokens",
}

const cosmosClient = new CosmosClient({
  endpoint: testAccount.endpoint,
  key: testAccount.key,
})

const database = cosmosClient.database(testAccount.databaseId)

runBasicTests({
  adapter: CosmosAdapter(cosmosClient),
  db: {
    async connect() {
      await database.containers.createIfNotExists({ id: containers.user })
      await database.containers.createIfNotExists({ id: containers.account })
      await database.containers.createIfNotExists({ id: containers.session })
      await database.containers.createIfNotExists({ id: containers.verificationToken })
    },
    async user(id) {
      try {
        const { resource: user } = await database.container(containers.user).item(id).read<AdapterUser>()
        return user
      } catch (e) {
        console.error(e)
        return null
      }
    },
    async account(provider_providerAccountId) {
      try {
        const querySpec = {
          query: "SELECT * FROM c WHERE c.providerId = @providerId AND c.providerAccountId = @providerAccountId",
          parameters: [
            { name: "@providerId", value: provider_providerAccountId.provider },
            { name: "@providerAccountId", value: provider_providerAccountId.providerAccountId },
          ],
        }
        const { resources: accounts } = await database.container(containers.account).items.query(querySpec).fetchAll()
        return accounts[0] || null
      } catch (e) {
        console.error(e)
        return null
      }
    },
    async session(sessionToken) {
      try {
        const { resource: session } = await database.container(containers.session).item(sessionToken).read()
        return session
      } catch (e) {
        console.error(e)
        return null
      }
    },
    async verificationToken(identifier_token) {
      try {
        const querySpec = {
          query: "SELECT * FROM c WHERE c.identifier = @identifier AND c.token = @token",
          parameters: [
            { name: "@identifier", value: identifier_token.identifier },
            { name: "@token", value: identifier_token.token },
          ],
        }
        const { resources: tokens } = await database.container(containers.verificationToken).items.query<VerificationToken>(querySpec).fetchAll()
        return tokens[0] || null
      } catch (e) {
        console.error(e)
        return null
      }
    },
  },
})