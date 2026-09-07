/**
 * Tracing and run accounting.
 *
 * `@opentelemetry/api` is a no-op until an SDK is registered, so instrumenting
 * costs nothing when nobody is collecting. The SDK is loaded lazily and only
 * when OTEL_EXPORTER_OTLP_ENDPOINT is set — a portfolio repo should not require
 * a collector to run, and a production deployment should not need a code change
 * to get traces.
 *
 * What is worth tracing here is not CPU time. It is which of several slow,
 * flaky public sources was slow this run, how much of it was served from cache,
 * and what the model cost — the questions you actually ask when a profile takes
 * 40 seconds instead of 2.
 */
import { SpanStatusCode, trace, type Span, type Tracer } from '@opentelemetry/api';

export const SERVICE_NAME = 'barback';

export const tracer: Tracer = trace.getTracer(SERVICE_NAME, '0.1.0');

let shutdownFn: (() => Promise<void>) | null = null;

/**
 * Register the OTLP exporter when an endpoint is configured. No endpoint means
 * the API stays a no-op and nothing is exported.
 */
export async function initTracing(log?: { info(m: string, meta?: Record<string, unknown>): void }): Promise<void> {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!endpoint || shutdownFn) return;

  try {
    const [{ NodeTracerProvider, BatchSpanProcessor }, { OTLPTraceExporter }, { resourceFromAttributes }, semconv] =
      await Promise.all([
        import('@opentelemetry/sdk-trace-node'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/semantic-conventions'),
      ]);

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [semconv.ATTR_SERVICE_NAME]: SERVICE_NAME,
        [semconv.ATTR_SERVICE_VERSION]: '0.1.0',
      }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))],
    });
    provider.register();
    shutdownFn = () => provider.shutdown();
    log?.info('tracing enabled', { endpoint });
  } catch (err) {
    // Never let observability break the thing being observed.
    log?.info('tracing unavailable, continuing without it', { error: String(err) });
  }
}

export async function shutdownTracing(): Promise<void> {
  if (!shutdownFn) return;
  await shutdownFn().catch(() => {});
  shutdownFn = null;
}

/** Run `fn` inside a span, recording exceptions without swallowing them. */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
