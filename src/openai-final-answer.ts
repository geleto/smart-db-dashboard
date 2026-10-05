import { wrapLanguageModel } from 'ai';
import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
	SharedV3ProviderMetadata,
} from '@ai-sdk/provider';

function messagePhase(metadata: SharedV3ProviderMetadata | undefined) {
	return metadata?.openai?.phase;
}

/**
 * Responses can contain commentary followed by a final answer. The AI SDK
 * concatenates both as text, which corrupts JSON, SQL, and HTML consumers.
 * Keep answer text and all non-text events, including the full billed usage.
 * Responses without phase metadata remain supported.
 */
export function withOpenAIFinalAnswer(model: LanguageModelV3): LanguageModelV3 {
	return wrapLanguageModel({
		model,
		middleware: {
			specificationVersion: 'v3',
			async wrapGenerate({ doGenerate }) {
				const result = await doGenerate();
				return {
					...result,
					content: result.content.filter(part =>
						part.type !== 'text' || messagePhase(part.providerMetadata) !== 'commentary'
					),
				};
			},
			async wrapStream({ doStream }) {
				const result = await doStream();
				const commentaryIds = new Set<string>();
				const pending = new Map<string, LanguageModelV3StreamPart[]>();
				return {
					...result,
					stream: result.stream.pipeThrough(new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
						transform(part, controller) {
							if (part.type === 'text-start') {
								const phase = messagePhase(part.providerMetadata);
								if (phase === 'commentary') {
									commentaryIds.add(part.id);
									return;
								}
								// If phase is only supplied on text-end, wait for it before
								// exposing text to parsers. Known final answers stream normally.
								if (phase == null) {
									pending.set(part.id, [part]);
									return;
								}
							}
							if (part.type === 'text-delta' || part.type === 'text-end') {
								if (commentaryIds.has(part.id)) {
									if (part.type === 'text-end') commentaryIds.delete(part.id);
									return;
								}
								const buffered = pending.get(part.id);
								if (buffered) {
									buffered.push(part);
									if (part.type === 'text-end') {
										pending.delete(part.id);
										if (messagePhase(part.providerMetadata) !== 'commentary') {
											for (const chunk of buffered) controller.enqueue(chunk);
										}
									}
									return;
								}
							}
							controller.enqueue(part);
						},
					})),
				};
			},
		},
	});
}
