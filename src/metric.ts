import type { types } from './types';

export function formatMetric(metric: types.Metric): string {
	if (metric.value === null) return '-';
	if (typeof metric.value === 'string') return metric.value + (metric.suffix ?? '');

	const options: Intl.NumberFormatOptions = {};
	if (metric.currency) {
		options.style = 'currency';
		options.currency = metric.currency;
	}
	if (metric.decimals != null) options.maximumFractionDigits = metric.decimals;
	return new Intl.NumberFormat(undefined, options).format(metric.value) + (metric.suffix ?? '');
}
