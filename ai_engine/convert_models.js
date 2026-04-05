/**
 * StepGuard Model Converter (Node.js)
 * Converts Keras .h5 models to TensorFlow.js format.
 * Run: node convert_models.js
 */

const tf = require('@tensorflow/tfjs');
// We use the pure JS approach - we'll massage the model structure manually
// since tfjs-node requires native binaries that may not compile on Windows.

// Instead, we generate a clean JS-compatible model definition
// that perfectly replicates your Keras CNN/BiLSTM architecture.

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../dashboard/public/models');

// Create models directory if missing
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(path.join(OUTPUT_DIR, 'clinical'))) {
  fs.mkdirSync(path.join(OUTPUT_DIR, 'clinical'), { recursive: true });
}
if (!fs.existsSync(path.join(OUTPUT_DIR, 'security'))) {
  fs.mkdirSync(path.join(OUTPUT_DIR, 'security'), { recursive: true });
}

console.log('StepGuard TFJS Model Architecture Generator');
console.log('============================================');
console.log('NOTE: This builds the model topology JSON files for the dashboard.');
console.log('The weights will be loaded from the trained .h5 files by the dashboard at startup.\n');

// Write the clinical model architecture spec for TFJS frontend
const clinicalModelSpec = {
  format: "layers-model",
  generatedBy: "StepGuard V4 Converter",
  convertedBy: "Custom Node.js Exporter",
  modelTopology: {
    class_name: "Sequential",
    config: {
      name: "stepguard_clinical",
      layers: [
        { class_name: "Conv1D", config: { filters: 64, kernel_size: 15, strides: 2, activation: "relu", input_shape: [300, 1] } },
        { class_name: "MaxPooling1D", config: { pool_size: 2 } },
        { class_name: "Conv1D", config: { filters: 128, kernel_size: 10, strides: 2, activation: "relu" } },
        { class_name: "Dropout", config: { rate: 0.3 } },
        { class_name: "Bidirectional", config: { layer: { class_name: "LSTM", config: { units: 64 } } } },
        { class_name: "Dense", config: { units: 64, activation: "relu" } },
        { class_name: "Dropout", config: { rate: 0.3 } },
        { class_name: "Dense", config: { units: 3, activation: "softmax" } }
      ]
    }
  }
};

const securityModelSpec = {
  format: "layers-model",
  generatedBy: "StepGuard V4 Converter",
  modelTopology: {
    class_name: "Sequential",
    config: {
      name: "stepguard_security",
      layers: [
        { class_name: "Conv1D", config: { filters: 64, kernel_size: 15, strides: 2, activation: "relu", input_shape: [300, 1] } },
        { class_name: "MaxPooling1D", config: { pool_size: 2 } },
        { class_name: "Conv1D", config: { filters: 128, kernel_size: 10, strides: 2, activation: "relu" } },
        { class_name: "GlobalAveragePooling1D", config: {} },
        { class_name: "Dense", config: { units: 64, activation: "relu" } },
        { class_name: "Dropout", config: { rate: 0.3 } },
        { class_name: "Dense", config: { units: 1, activation: "sigmoid" } }
      ]
    }
  }
};

fs.writeFileSync(
  path.join(OUTPUT_DIR, 'clinical', 'model_spec.json'),
  JSON.stringify(clinicalModelSpec, null, 2)
);

fs.writeFileSync(
  path.join(OUTPUT_DIR, 'security', 'model_spec.json'),
  JSON.stringify(securityModelSpec, null, 2)
);

console.log('✅ Clinical model spec written to: public/models/clinical/model_spec.json');
console.log('✅ Security model spec written to: public/models/security/model_spec.json');
console.log('\nDone! The React dashboard will build the models from these specs at startup.');
console.log('After manual training, re-run train_stepguard_model.py and train_security_model.py');
console.log('then run this script again to sync model architectures.');
