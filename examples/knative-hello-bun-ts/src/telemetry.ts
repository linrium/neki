import { metrics, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

export const serviceName = process.env.OTEL_SERVICE_NAME ?? "hello-bun-ts";

const otlpEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://alloy.observability.svc.cluster.local:4318").replace(
  /\/$/,
  "",
);

const resource = resourceFromAttributes({
  "service.name": serviceName,
  "service.namespace": "examples",
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${otlpEndpoint}/v1/metrics`,
      }),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 5000),
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${otlpEndpoint}/v1/logs`,
      }),
    ),
  ],
});

sdk.start();

const tracer = trace.getTracer(serviceName);
const meter = metrics.getMeter(serviceName);
const logger = logs.getLogger(serviceName);
const requestCounter = meter.createCounter("http.server.request.count", {
  description: "Total HTTP requests handled by the app.",
});
const requestDuration = meter.createHistogram("http.server.request.duration", {
  description: "HTTP request duration.",
  unit: "ms",
});

type RequestHandler = () => Response | Promise<Response>;

function requestAttributes(method: string, route: string, statusCode: number) {
  return {
    "service.name": serviceName,
    "http.request.method": method,
    "http.route": route,
    "http.response.status_code": statusCode,
  };
}

export async function instrumentRequest(request: Request, route: string, handler: RequestHandler) {
  return tracer.startActiveSpan(
    `${request.method} ${route}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": request.method,
        "http.route": route,
        "url.path": new URL(request.url).pathname,
      },
    },
    async (span) => {
      const startedAt = performance.now();
      let statusCode = 500;

      try {
        const response = await handler();
        statusCode = response.status;
        span.setAttribute("http.response.status_code", statusCode);
        span.setStatus({ code: statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
        return response;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        const durationMs = performance.now() - startedAt;
        const attributes = requestAttributes(request.method, route, statusCode);
        requestCounter.add(1, attributes);
        requestDuration.record(durationMs, attributes);
        logger.emit({
          severityNumber: statusCode >= 500 ? SeverityNumber.ERROR : SeverityNumber.INFO,
          severityText: statusCode >= 500 ? "ERROR" : "INFO",
          body: `${request.method} ${route} ${statusCode}`,
          attributes: {
            ...attributes,
            "http.server.request.duration_ms": durationMs,
          },
        });
        span.end();
      }
    },
  );
}

export function logInfo(message: string, attributes: Record<string, string | number | boolean> = {}) {
  console.log(message);
  logger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: message,
    attributes,
  });
}

export function logError(message: string, attributes: Record<string, string | number | boolean> = {}) {
  console.error(message);
  logger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: message,
    attributes,
  });
}

async function shutdown() {
  await sdk.shutdown();
}

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
