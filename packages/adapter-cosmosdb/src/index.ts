/**
 * <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px"}}>
 *  <p>Official <a href="https://azure.microsoft.com/en-us/products/cosmos-db">cosmosdb</a> adapter for Auth.js / NextAuth.js.</p>
 *  <a href="https://azure.microsoft.com/en-us/products/cosmos-db">
 *   <img style={{display: "block"}} src="/img/adapters/cosmosdb.svg" width="38" />
 *  </a>
 * </div>
 *
 * ## Installation
 *
 * ```bash npm2yarn
 * npm install @auth/cosmosdb-adapter
 * ```
 *
 * @module @auth/cosmosdb-adapter
 */
import type {
  Adapter,
  AdapterUser,
  AdapterAccount,
  AdapterSession,
  VerificationToken,
} from '@auth/core/adapters';
import type { CosmosClient, SqlQuerySpec, Container, Database, DatabaseRequest, ContainerRequest } from '@azure/cosmos';

const DEFAULT_DB_NAME = 'auth';
const CONTAINER_USERS = 'users';
const CONTAINER_ACCOUNTS = 'accounts';
const CONTAINER_SESSIONS = 'sessions';
const CONTAINER_VERIFICATION_TOKENS = 'verification_tokens';

const PARTITION_KEY_USERS = '/id';
const PARTITION_KEY_ACCOUNTS = '/user_id';
const PARTITION_KEY_SESSIONS = '/session_token';
const PARTITION_KEY_VERIFICATION_TOKENS = '/identifier';

const isDate = (val: any): val is ConstructorParameters<typeof Date>[0] => 
  !!(val && !isNaN(Date.parse(val)));

const format = {
  /** Takes an object coming from the database and converts it to plain JS */
  from<T>(object: Record<string, any> = {}): T {
    const newObject: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(object)) {
      if (key.startsWith("_")) continue; // Skip Cosmos DB system properties
      if (isDate(value)) newObject[key] = new Date(value);
      else newObject[key] = value;
    }
    return newObject as T;
  },
  /** Takes an object from Auth.js and prepares it to write to the database */  
  to<T>(object: Record<string, any>): T {
    const newObject: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(object)) {
      if (key.startsWith("_")) continue; // Skip Cosmos DB system properties
      if (value instanceof Date) newObject[key] = value.toISOString();
      else newObject[key] = value;
    }
    return newObject as T;
  },
};

export default function CosmosAdapter(client: CosmosClient): Adapter {
  let db: Database | null = null;
  const containers: Record<string, Container> = {};

  async function initializeDatabase(
    dbOptions: DatabaseRequest = { id: DEFAULT_DB_NAME }
  ): Promise<void> {
    if (!db) {
      const { database } = await client.databases.createIfNotExists(dbOptions);
      db = database;
    }
  }

  function getContainerOptions(containerId: string): ContainerRequest {
    switch (containerId) {
      case CONTAINER_USERS:
        return {
          id: containerId,
          partitionKey: { paths: [PARTITION_KEY_USERS] },
        };
      case CONTAINER_ACCOUNTS:
        return {
          id: containerId, 
          partitionKey: { paths: [PARTITION_KEY_ACCOUNTS] },
        };
      case CONTAINER_SESSIONS: 
        return {
          id: containerId,
          partitionKey: { paths: [PARTITION_KEY_SESSIONS] },
        };
      case CONTAINER_VERIFICATION_TOKENS:
        return {
          id: containerId,
          partitionKey: { paths: [PARTITION_KEY_VERIFICATION_TOKENS] },
        };
      default:
        throw new Error(`Unknown container: ${containerId}`);
    }
  }

  async function getContainer(containerId: string): Promise<Container> {
    if (!containers[containerId]) {
      await initializeDatabase();
      const { container } = await db!.containers.createIfNotExists(
        getContainerOptions(containerId)
      ); 
      containers[containerId] = container;
    }
    return containers[containerId];
  }

  return {
    async createUser(user: Omit<AdapterUser, "id">): Promise<AdapterUser> {
      const container = await getContainer(CONTAINER_USERS);
      const { resource: createdUser } = await container.items.create<AdapterUser>(format.to(user)); 
      return format.from<AdapterUser>(createdUser);
    },

    async getUser(id: string): Promise<AdapterUser | null> {
      const container = await getContainer(CONTAINER_USERS);
      const { resource: user } = await container.item(id).read<AdapterUser>();
      return user ? format.from<AdapterUser>(user) : null;
    },

    async getUserByEmail(email: string): Promise<AdapterUser | null> {
      const container = await getContainer(CONTAINER_USERS);
      const query: SqlQuerySpec = {
        query: "SELECT * FROM c WHERE c.email = @email", 
        parameters: [{ name: "@email", value: email }],
      };
      const { resources: users } = await container.items.query<AdapterUser>(query).fetchAll();
      return users[0] ? format.from<AdapterUser>(users[0]) : null;  
    },

    async getUserByAccount(
      account: Pick<AdapterAccount, 'providerAccountId' | 'provider'>
    ): Promise<AdapterUser | null> {
      const container = await getContainer(CONTAINER_ACCOUNTS);
      const query: SqlQuerySpec = {
        query: "SELECT * FROM c WHERE c.provider_account_id = @providerAccountId AND c.provider = @provider",
        parameters: [
          { name: "@providerAccountId", value: account.providerAccountId },
          { name: "@provider", value: account.provider },
        ],
      };
      const { resources: accounts } = await container.items.query<AdapterAccount>(query).fetchAll();
      if (!accounts[0]) return null;

      return this.getUser(accounts[0].userId);
    },

    async updateUser(user: Partial<AdapterUser>): Promise<AdapterUser> {
      const container = await getContainer(CONTAINER_USERS);
      const existingUser = await this.getUser(user.id!);
      if (!existingUser) throw new Error("User not found");
      
      const updates = format.to({...existingUser, ...user});
      const { resource: updatedUser } = await container.item(user.id!).replace<AdapterUser>(updates);
      return format.from<AdapterUser>(updatedUser);
    },

    async deleteUser(userId: string): Promise<void> {
      const container = await getContainer(CONTAINER_USERS); 
      await container.item(userId).delete();
    },

    async linkAccount(account: AdapterAccount): Promise<AdapterAccount> {
      const container = await getContainer(CONTAINER_ACCOUNTS);
      const { resource: createdAccount } = await container.items.create<AdapterAccount>(format.to(account));
      return format.from<AdapterAccount>(createdAccount);
    },

    async unlinkAccount(
      account: Pick<AdapterAccount, 'providerAccountId' | 'provider'>  
    ): Promise<void> {
      const container = await getContainer(CONTAINER_ACCOUNTS);
      const query: SqlQuerySpec = {
        query: "SELECT * FROM c WHERE c.provider_account_id = @providerAccountId AND c.provider = @provider",
        parameters: [
          { name: "@providerAccountId", value: account.providerAccountId },
          { name: "@provider", value: account.provider },
        ],
      };
      const { resources: accounts } = await container.items.query(query).fetchAll();
      if (accounts[0]) await container.item(accounts[0].id).delete();
    },

    async createSession(session: AdapterSession): Promise<AdapterSession> {
      const container = await getContainer(CONTAINER_SESSIONS);
      const { resource: createdSession } = await container.items.create<AdapterSession>(format.to(session));
      return format.from<AdapterSession>(createdSession);
    },

    async getSessionAndUser(sessionToken: string): Promise<{ session: AdapterSession; user: AdapterUser; } | null> {
      const container = await getContainer(CONTAINER_SESSIONS);
      const { resources: sessions } = await container.items
        .query<AdapterSession>({
          query: "SELECT * FROM c WHERE c.sessionToken = @sessionToken",
          parameters: [{ name: "@sessionToken", value: sessionToken }], 
        })
        .fetchAll();
      if (!sessions[0]) return null;

      const user = await this.getUser(sessions[0].userId);
      if (!user) return null;

      return {
        session: format.from<AdapterSession>(sessions[0]),
        user: format.from<AdapterUser>(user),
      };
    },

    async updateSession(session: Partial<AdapterSession>): Promise<AdapterSession> {
      const container = await getContainer(CONTAINER_SESSIONS);
      const existingSession = await container.item(session.sessionToken!).read<AdapterSession>().resource;
      if (!existingSession) throw new Error("Session not found");

      const updates = format.to({...existingSession, ...session});
      const { resource: updatedSession } = await container.item(existingSession.sessionToken).replace<AdapterSession>(updates);
      return format.from<AdapterSession>(updatedSession);
    },

    async deleteSession(sessionToken: string): Promise<void> {
      const container = await getContainer(CONTAINER_SESSIONS);
      await container.item(sessionToken).delete();
    },

    async createVerificationToken(token: VerificationToken): Promise<VerificationToken> {
      const container = await getContainer(CONTAINER_VERIFICATION_TOKENS);
      const { resource: createdToken } = await container.items.create<VerificationToken>(format.to(token));
      return format.from<VerificationToken>(createdToken); 
    },

    async useVerificationToken(params: {
      identifier: string;
      token: string;
    }): Promise<AdapterUser | null> {
      const { identifier, token } = params;
      const container = await getContainer(CONTAINER_VERIFICATION_TOKENS);
      const query: SqlQuerySpec = {
        query: "SELECT * FROM c WHERE c.identifier = @identifier AND c.token = @token",
        parameters: [
          { name: "@identifier", value: identifier },
          { name: "@token", value: token },
        ],
      };
      const { resources: tokens } = await container.items.query<VerificationToken>(query).fetchAll();
      if (!tokens[0]) return null;
          
      const user = await this.getUserByEmail(identifier);
      if (!user) return null;
          
      await this.updateUser({id: user.id, emailVerified: new Date()});

      await container.item(tokens[0].id).delete();

      return user;
    },
  };
}