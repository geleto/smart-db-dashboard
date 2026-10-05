import 'dotenv/config';

import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { withProgressIndicator } from './model-logging';
import type { ModelPricing } from './model-logging';
import { withOpenAIFinalAnswer } from './openai-final-answer';

const showProgressIndicators = true;
type LunaReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
// Keep drafts fast; use a reasoning pass for planning, repairs, and insights.
const basicReasoningEffort: LunaReasoningEffort = 'none';
const advancedReasoningEffort: LunaReasoningEffort = 'low';

// Manual USD per 1M token prices for rough log estimates.
// Standard rates checked 2026-10-05; Luna rates apply up to 272K input tokens.
const modelPricing = {
	gpt6Luna: {
		inputUsdPerMillion: 0.10,
		cachedInputUsdPerMillion: 0.01,
		cacheWriteUsdPerMillion: 0.125,
		outputUsdPerMillion: 0.50,
	},
	claude45Haiku: {
		inputUsdPerMillion: 1.00,
		cachedInputUsdPerMillion: 0.10,
		cacheWriteUsdPerMillion: 1.25,
		outputUsdPerMillion: 5.00,
	},
} satisfies Record<string, ModelPricing>;

const openaiBaseOptions = {
	promptCacheKey: 'smart-db-dashboard',
};

export const basicProviderOptions = {
	openai: {
		...openaiBaseOptions,
		reasoningEffort: basicReasoningEffort,
	},
};

const advancedModelOptions = {
	haiku: {
		model: anthropic('claude-haiku-4-5'),
		label: 'Claude-4.5-Haiku (no reasoning)',
		pricing: modelPricing.claude45Haiku,
		providerOptions: {
			anthropic: {
				structuredOutputMode: 'jsonTool' as const,
			},
		},
	},
	'gpt-luna': {
		model: withOpenAIFinalAnswer(openai.responses('gpt-6-luna')),
		label: `GPT-6-Luna (reasoning: ${advancedReasoningEffort})`,
		pricing: modelPricing.gpt6Luna,
		providerOptions: {
			openai: {
				...openaiBaseOptions,
				reasoningEffort: advancedReasoningEffort,
			},
		},
	},
} as const;
const advancedModelChoice: keyof typeof advancedModelOptions = 'gpt-luna';
const advancedModelSettings = advancedModelOptions[advancedModelChoice];

export const advancedProviderOptions = advancedModelSettings.providerOptions;

export const basicModel = withProgressIndicator(
	withOpenAIFinalAnswer(openai.responses('gpt-6-luna')),
	`GPT-6-Luna (reasoning: ${basicReasoningEffort})`,
	showProgressIndicators,
	modelPricing.gpt6Luna
);

export const advancedModel = withProgressIndicator(
	advancedModelSettings.model,
	advancedModelSettings.label,
	showProgressIndicators,
	advancedModelSettings.pricing
);
