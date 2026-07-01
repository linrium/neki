import type {
  KubernetesObject,
  KubernetesObjectApi,
} from "@kubernetes/client-node"
import { getNumber, getRecord, sleep } from "./utils"

export async function createRustfsBucketJob(
  objectApi: KubernetesObjectApi,
  input: {
    bucketName: string
    endpoint: string
    jobName: string
    namespace: string
    secretName: string
  },
) {
  await objectApi.create(
    {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: input.jobName,
        namespace: input.namespace,
        labels: {
          "app.kubernetes.io/managed-by": "neki-console",
          "app.kubernetes.io/name": "rustfs-bucket",
        },
      },
      spec: {
        backoffLimit: 3,
        template: {
          spec: {
            restartPolicy: "Never",
            containers: [
              {
                name: "mc",
                image: "minio/mc:latest",
                imagePullPolicy: "IfNotPresent",
                env: [
                  { name: "RUSTFS_ENDPOINT", value: input.endpoint },
                  { name: "RUSTFS_BUCKET", value: input.bucketName },
                  {
                    name: "RUSTFS_ACCESS_KEY",
                    valueFrom: {
                      secretKeyRef: {
                        name: input.secretName,
                        key: "RUSTFS_ACCESS_KEY",
                      },
                    },
                  },
                  {
                    name: "RUSTFS_SECRET_KEY",
                    valueFrom: {
                      secretKeyRef: {
                        name: input.secretName,
                        key: "RUSTFS_SECRET_KEY",
                      },
                    },
                  },
                ],
                command: [
                  "/bin/sh",
                  "-ec",
                  [
                    'mc alias set rustfs "$RUSTFS_ENDPOINT" "$RUSTFS_ACCESS_KEY" "$RUSTFS_SECRET_KEY"',
                    'mc mb --ignore-existing "rustfs/$RUSTFS_BUCKET"',
                  ].join("\n"),
                ],
              },
            ],
          },
        },
      },
    },
    undefined,
    undefined,
    "neki-console",
  )
}

export async function waitForJobComplete(
  objectApi: KubernetesObjectApi,
  namespace: string,
  jobName: string,
) {
  const timeoutAt = Date.now() + 120_000

  while (Date.now() < timeoutAt) {
    const job = await objectApi.read<KubernetesObject & { status?: unknown }>({
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: jobName,
        namespace,
      },
    })
    const status = getRecord(job.status)
    const succeeded = getNumber(status?.succeeded) ?? 0
    const failed = getNumber(status?.failed) ?? 0

    if (succeeded > 0) {
      return
    }

    if (failed >= 3) {
      throw new Error(`RustFS bucket job ${namespace}/${jobName} failed.`)
    }

    await sleep(2000)
  }

  throw new Error(
    `RustFS bucket job ${namespace}/${jobName} did not complete in time.`,
  )
}

export function buildRustfsBucketJobName(bucketName: string) {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${bucketName.slice(0, 43)}-${suffix}`.replace(/-+$/g, "")
}
