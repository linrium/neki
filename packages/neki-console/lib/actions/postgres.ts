import type { CustomObjectsApi } from "@kubernetes/client-node"
import type { KubernetesCustomObject, SecretObject } from "./types"
import { getErrorStatus } from "./utils"

export async function ensurePostgresClusterIsNew(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  clusterName: string,
) {
  try {
    await customObjectsApi.getNamespacedCustomObject({
      group: "postgresql.cnpg.io",
      version: "v1",
      namespace,
      plural: "clusters",
      name: clusterName,
    })
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      return
    }
    throw error
  }

  throw new Error(
    `Postgres cluster ${namespace}/${clusterName} already exists.`,
  )
}

export function buildPostgresSecret({
  namespace,
  name,
  username,
  password,
  clusterName,
  serviceName,
}: {
  namespace: string
  name: string
  username: string
  password: string
  clusterName: string
  serviceName: string
}): SecretObject {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name,
      namespace,
      labels: {
        "app.kubernetes.io/managed-by": "neki-console",
        "app.kubernetes.io/part-of": serviceName,
        "cnpg.io/cluster": clusterName,
      },
    },
    type: "kubernetes.io/basic-auth",
    stringData: {
      username,
      password,
    },
  }
}

export function buildPostgresCluster({
  namespace,
  clusterName,
  database,
  username,
  secretName,
  instances,
  storageSize,
  postgresVersion,
  serviceName,
  vaultComponent,
  vaultPath,
}: {
  namespace: string
  clusterName: string
  database: string
  username: string
  secretName: string
  instances: number
  storageSize: string
  postgresVersion: string
  serviceName: string
  vaultComponent: string
  vaultPath: string
}): KubernetesCustomObject {
  return {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Cluster",
    metadata: {
      name: clusterName,
      namespace,
      annotations: {
        "neki.dev/dapr-vault-component": vaultComponent,
        "neki.dev/dapr-vault-path": vaultPath,
      },
      labels: {
        "app.kubernetes.io/managed-by": "neki-console",
        "app.kubernetes.io/part-of": serviceName,
      },
    },
    spec: {
      instances,
      imageName: `ghcr.io/cloudnative-pg/postgresql:${postgresVersion}`,
      storage: {
        size: storageSize,
      },
      monitoring: {
        enablePodMonitor: true,
      },
      bootstrap: {
        initdb: {
          database,
          owner: username,
          secret: {
            name: secretName,
          },
        },
      },
      postgresql: {
        parameters: {
          max_connections: "200",
          shared_buffers: "256MB",
        },
      },
      resources: {
        requests: {
          cpu: "250m",
          memory: "512Mi",
        },
        limits: {
          cpu: "1",
          memory: "1Gi",
        },
      },
    },
  }
}
