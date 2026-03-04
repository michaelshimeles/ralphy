/**
 * Metrics and Tracing System for Ralphy CLI
 *
 * Provides observability with:
 * - Metrics collection (counters, gauges, histograms)
 * - Distributed tracing (OpenTelemetry-style spans)
 * - Multiple exporters (console, file, Prometheus)
 */

import { randomBytes } from "node:crypto";
import { logDebugContext } from "../ui/logger.ts";

/**
 * Metric types
 */
export type MetricType = "counter" | "gauge" | "histogram";

/**
 * Metric value
 */
export type MetricValue = number | Record<string, number> | HistogramValue;

/**
 * Metric labels/tags
 */
export interface MetricLabels {
	[key: string]: string | number | boolean;
}

/**
 * Metric definition
 */
export interface Metric {
	name: string;
	type: MetricType;
	description: string;
	unit?: string;
	labels?: MetricLabels;
	value: MetricValue;
	timestamp: number;
}

/**
 * Histogram bucket
 */
export interface HistogramBucket {
	le: number; // less than or equal
	count: number;
}

/**
 * Histogram value
 */
export interface HistogramValue {
	count: number;
	sum: number;
	buckets: HistogramBucket[];
}

/**
 * Span context for distributed tracing
 */
export interface SpanContext {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	sampled: boolean;
}

/**
 * Span status
 */
export type SpanStatus = "unset" | "ok" | "error";

/**
 * Span event
 */
export interface SpanEvent {
	timestamp: number;
	name: string;
	attributes?: Record<string, unknown>;
}

/**
 * Span representation
 */
export interface Span {
	context: SpanContext;
	name: string;
	startTime: number;
	endTime?: number;
	status: SpanStatus;
	attributes: Record<string, unknown>;
	events: SpanEvent[];
	links?: SpanContext[];
}

/**
 * Metrics collector interface
 */
export interface MetricsCollector {
	/**
	 * Increment a counter metric
	 */
	counter(name: string, value?: number, labels?: MetricLabels): void;

	/**
	 * Set a gauge metric value
	 */
	gauge(name: string, value: number, labels?: MetricLabels): void;

	/**
	 * Record a histogram observation
	 */
	histogram(name: string, value: number, labels?: MetricLabels): void;

	/**
	 * Get all collected metrics
	 */
	getMetrics(): Metric[];

	/**
	 * Clear all metrics
	 */
	clear(): void;
}

/**
 * Tracer interface
 */
export interface Tracer {
	/**
	 * Start a new span
	 */
	startSpan(name: string, parentContext?: SpanContext, attributes?: Record<string, unknown>): Span;

	/**
	 * End a span
	 */
	endSpan(span: Span, status?: SpanStatus): void;

	/**
	 * Add event to span
	 */
	addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void;

	/**
	 * Get active span
	 */
	getActiveSpan(): Span | null;

	/**
	 * Set active span
	 */
	setActiveSpan(span: Span | null): void;
}

/**
 * Exporter interface for metrics and traces
 */
export interface Exporter {
	/**
	 * Export metrics
	 */
	exportMetrics(metrics: Metric[]): Promise<void>;

	/**
	 * Export spans
	 */
	exportSpans(spans: Span[]): Promise<void>;

	/**
	 * Shutdown exporter
	 */
	shutdown(): Promise<void>;
}

/**
 * In-memory metrics collector implementation
 */
class InMemoryMetricsCollector implements MetricsCollector {
	private metrics: Map<string, Metric> = new Map();
	private histogramBuckets: Map<string, number[]> = new Map();
	private static readonly MAX_HISTOGRAM_SAMPLES = 10000;

	counter(name: string, value = 1, labels?: MetricLabels): void {
		const key = this.getMetricKey(name, labels);
		const existing = this.metrics.get(key);

		if (existing && existing.type === "counter") {
			existing.value = (existing.value as number) + value;
		} else {
			this.metrics.set(key, {
				name,
				type: "counter",
				description: `Counter metric: ${name}`,
				labels,
				value,
				timestamp: Date.now(),
			});
		}

		logDebugContext("Metrics", `Counter ${name}: +${value}`);
	}

	gauge(name: string, value: number, labels?: MetricLabels): void {
		const key = this.getMetricKey(name, labels);

		this.metrics.set(key, {
			name,
			type: "gauge",
			description: `Gauge metric: ${name}`,
			labels,
			value,
			timestamp: Date.now(),
		});

		logDebugContext("Metrics", `Gauge ${name}: ${value}`);
	}

	histogram(name: string, value: number, labels?: MetricLabels): void {
		const key = this.getMetricKey(name, labels);
		const bucketKey = `${key}_buckets`;

		// Store raw values for histogram calculation (capped)
		const buckets = this.histogramBuckets.get(bucketKey) || [];
		buckets.push(value);
		if (buckets.length > InMemoryMetricsCollector.MAX_HISTOGRAM_SAMPLES) {
			buckets.shift();
		}
		this.histogramBuckets.set(bucketKey, buckets);

		// Calculate histogram stats
		const sum = buckets.reduce((a, b) => a + b, 0);
		const sorted = [...buckets].sort((a, b) => a - b);

		// Create default buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
		const bucketBoundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
		const histogramBuckets: HistogramBucket[] = bucketBoundaries.map((le) => ({
			le,
			count: sorted.filter((v) => v <= le).length,
		}));
		// Add +Inf bucket
		histogramBuckets.push({ le: Infinity, count: buckets.length });

		const histogramValue: HistogramValue = {
			count: buckets.length,
			sum,
			buckets: histogramBuckets,
		};

		this.metrics.set(key, {
			name,
			type: "histogram",
			description: `Histogram metric: ${name}`,
			labels,
			value: histogramValue,
			timestamp: Date.now(),
		});

		logDebugContext("Metrics", `Histogram ${name}: ${value}`);
	}

	getMetrics(): Metric[] {
		return Array.from(this.metrics.values());
	}

	clear(): void {
		this.metrics.clear();
		this.histogramBuckets.clear();
	}

	private getMetricKey(name: string, labels?: MetricLabels): string {
		if (!labels || Object.keys(labels).length === 0) {
			return name;
		}
		const labelStr = Object.entries(labels)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}=${v}`)
			.join(",");
		return `${name}{${labelStr}}`;
	}
}

/**
 * Simple tracer implementation
 */
class SimpleTracer implements Tracer {
	private spans: Span[] = [];
	private activeSpan: Span | null = null;
	private idCounter = 0;

	startSpan(name: string, parentContext?: SpanContext, attributes?: Record<string, unknown>): Span {
		const spanId = this.generateId();
		const traceId = parentContext?.traceId || this.generateId();

		const span: Span = {
			context: {
				traceId,
				spanId,
				parentSpanId: parentContext?.spanId,
				sampled: parentContext?.sampled ?? true,
			},
			name,
			startTime: Date.now(),
			status: "unset",
			attributes: attributes || {},
			events: [],
		};

		this.spans.push(span);
		logDebugContext("Tracer", `Started span: ${name} (${spanId})`);

		return span;
	}

	endSpan(span: Span, status: SpanStatus = "ok"): void {
		span.endTime = Date.now();
		span.status = status;
		logDebugContext("Tracer", `Ended span: ${span.name} (${span.context.spanId}) - ${status}`);
	}

	addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void {
		span.events.push({
			timestamp: Date.now(),
			name,
			attributes,
		});
		logDebugContext("Tracer", `Event in ${span.name}: ${name}`);
	}

	getActiveSpan(): Span | null {
		return this.activeSpan;
	}

	setActiveSpan(span: Span | null): void {
		this.activeSpan = span;
	}

	getSpans(): Span[] {
		return this.spans;
	}

	private generateId(): string {
		return `${Date.now().toString(36)}-${(++this.idCounter).toString(36)}-${randomBytes(9).toString("base64url").slice(0, 12)}`;
	}
}

/**
 * Global metrics collector instance
 */
let globalMetricsCollector: MetricsCollector = new InMemoryMetricsCollector();

/**
 * Global tracer instance
 */
let globalTracer: Tracer = new SimpleTracer();

/**
 * Set global metrics collector
 */
export function setMetricsCollector(collector: MetricsCollector): void {
	globalMetricsCollector = collector;
}

/**
 * Get global metrics collector
 */
export function getMetricsCollector(): MetricsCollector {
	return globalMetricsCollector;
}

/**
 * Set global tracer
 */
export function setTracer(tracer: Tracer): void {
	globalTracer = tracer;
}

/**
 * Get global tracer
 */
export function getTracer(): Tracer {
	return globalTracer;
}

/**
 * Record a counter metric (convenience function)
 */
export function recordCounter(name: string, value = 1, labels?: MetricLabels): void {
	globalMetricsCollector.counter(name, value, labels);
}

/**
 * Record a gauge metric (convenience function)
 */
export function recordGauge(name: string, value: number, labels?: MetricLabels): void {
	globalMetricsCollector.gauge(name, value, labels);
}

/**
 * Record a histogram observation (convenience function)
 */
export function recordHistogram(name: string, value: number, labels?: MetricLabels): void {
	globalMetricsCollector.histogram(name, value, labels);
}

/**
 * Start a span (convenience function)
 */
export function startSpan(name: string, parentContext?: SpanContext, attributes?: Record<string, unknown>): Span {
	return globalTracer.startSpan(name, parentContext, attributes);
}

/**
 * End a span (convenience function)
 */
export function endSpan(span: Span, status?: SpanStatus): void {
	globalTracer.endSpan(span, status);
}

/**
 * Run function within a span
 */
export async function withSpan<T>(
	name: string,
	fn: (span: Span) => Promise<T>,
	parentContext?: SpanContext,
	attributes?: Record<string, unknown>,
): Promise<T> {
	const span = startSpan(name, parentContext, attributes);
	const prevActive = globalTracer.getActiveSpan();
	globalTracer.setActiveSpan(span);

	try {
		const result = await fn(span);
		endSpan(span, "ok");
		return result;
	} catch (error) {
		endSpan(span, "error");
		span.attributes.error = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		globalTracer.setActiveSpan(prevActive);
	}
}

// Re-export types
export { InMemoryMetricsCollector, SimpleTracer };
