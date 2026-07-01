import type { CustomObjectsApi } from "@kubernetes/client-node"
import { listCustomObjects } from "./kubernetes"
import { toDaprResource } from "./mappers"
import type { DaprResource, KubernetesCustomObject } from "./types"

export async function listDaprResources(
  customObjectsApi: CustomObjectsApi,
): Promise<{ resources: DaprResource[]; errors: string[] }> {
  const [componentsResult, configurationsResult, subscriptionsResult] =
    await Promise.all([
      listCustomObjects(customObjectsApi, {
        group: "dapr.io",
        version: "v1alpha1",
        plural: "components",
        label: "Dapr components",
      }),
      listCustomObjects(customObjectsApi, {
        group: "dapr.io",
        version: "v1alpha1",
        plural: "configurations",
        label: "Dapr configurations",
      }),
      listCustomObjects(customObjectsApi, {
        group: "dapr.io",
        version: "v2alpha1",
        plural: "subscriptions",
        label: "Dapr subscriptions",
      }),
    ])

  return {
    resources: [
      ...componentsResult.items.map((item: KubernetesCustomObject) =>
        toDaprResource(item, "Component"),
      ),
      ...configurationsResult.items.map((item: KubernetesCustomObject) =>
        toDaprResource(item, "Configuration"),
      ),
      ...subscriptionsResult.items.map((item: KubernetesCustomObject) =>
        toDaprResource(item, "Subscription"),
      ),
    ],
    errors: [
      ...componentsResult.errors,
      ...configurationsResult.errors,
      ...subscriptionsResult.errors,
    ],
  }
}
