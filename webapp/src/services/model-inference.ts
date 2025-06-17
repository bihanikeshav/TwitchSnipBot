/**
 * ONNX Runtime Web inference for highlight detection.
 * Loads a pre-trained ONNX model and runs inference in the browser via WASM.
 */
import * as ort from 'onnxruntime-web';

export interface ModelPrediction {
  detectionScore: number;
  isHighlight: boolean;
  category: string;
  categoryScores: Record<string, number>;
}

const CATEGORIES = ['funny', 'exciting', 'surprising', 'other'];

export class ModelInference {
  private session: ort.InferenceSession | null = null;
  private sequenceLength: number;
  private inputSize: number;

  constructor(sequenceLength = 12, inputSize = 12) {
    this.sequenceLength = sequenceLength;
    this.inputSize = inputSize;
  }

  async loadModel(modelPath = '/models/highlight.onnx'): Promise<void> {
    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
    });
  }

  async predict(featureSequence: number[][]): Promise<ModelPrediction> {
    if (!this.session) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    // Pad or truncate to sequence length
    const padded = this.padSequence(featureSequence);

    // Create input tensor: shape [1, sequenceLength, inputSize]
    const flatData = new Float32Array(padded.flat());
    const inputTensor = new ort.Tensor('float32', flatData, [1, this.sequenceLength, this.inputSize]);

    const results = await this.session.run({ input: inputTensor });

    // Parse detection output (ONNX model already outputs probabilities).
    const detectionData = results['detection'].data as Float32Array;
    const detectionScore = detectionData[0];

    // Parse classification output (ONNX model already outputs probabilities).
    const classificationData = results['classification'].data as Float32Array;
    const categoryScores = Array.from(classificationData);

    const maxIdx = categoryScores.indexOf(Math.max(...categoryScores));

    return {
      detectionScore,
      isHighlight: detectionScore > 0.5,
      category: CATEGORIES[maxIdx],
      categoryScores: Object.fromEntries(CATEGORIES.map((c, i) => [c, categoryScores[i]])),
    };
  }

  isLoaded(): boolean {
    return this.session !== null;
  }

  private padSequence(seq: number[][]): number[][] {
    if (seq.length >= this.sequenceLength) {
      return seq.slice(-this.sequenceLength);
    }

    // Pad with zeros at the beginning
    const padding = Array.from({ length: this.sequenceLength - seq.length }, () =>
      new Array(this.inputSize).fill(0),
    );
    return [...padding, ...seq];
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function softmax(arr: number[]): number[] {
  const max = Math.max(...arr);
  const exps = arr.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}
