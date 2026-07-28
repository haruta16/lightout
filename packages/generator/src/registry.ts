import type {
  GenerationEvaluator,
  GenerationLayerId,
  GenerationRegistry,
  PuzzleLayerGenerator,
} from "./types";

export function layerGeneratorKey(
  layer: GenerationLayerId,
  type: string,
  version: number,
): string {
  return `${layer}:${type}@${version}`;
}

export function createGenerationRegistry(): GenerationRegistry {
  return {
    layerGenerators: new Map(),
    evaluators: new Map(),
  };
}

export function registerLayerGenerator(
  registry: GenerationRegistry,
  generator: PuzzleLayerGenerator,
): void {
  registry.layerGenerators.set(
    layerGeneratorKey(generator.layer, generator.type, generator.version),
    generator,
  );
}

export function registerGenerationEvaluator(
  registry: GenerationRegistry,
  evaluator: GenerationEvaluator,
): void {
  registry.evaluators.set(evaluator.type, evaluator);
}
