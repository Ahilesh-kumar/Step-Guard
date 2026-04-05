import tensorflow as tf
import numpy as np
import json
import os

DASHBOARD_MODELS_DIR = os.path.join("..", "dashboard", "public", "models")

def convert_model(h5_path, output_name):
    output_dir = os.path.join(DASHBOARD_MODELS_DIR, output_name)
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"\nProcessing {h5_path}...")
    model = tf.keras.models.load_model(h5_path)
    
    tfjs_layers = []
    weight_data_list = []
    weight_specs = []
    
    for layer in model.layers:
        l_class = layer.__class__.__name__
        if l_class == 'InputLayer': continue
        
        l_config = layer.get_config()
        tfjs_layer = {"class_name": l_class, "config": {}}
        
        layer_weights = layer.weights
        for w in layer_weights:
            arr = w.numpy().astype(np.float32)
            weight_data_list.append(arr)
            
            clean_name = w.name.replace(':0', '')
            if clean_name.startswith(layer.name + "/"):
                final_name = clean_name
            else:
                final_name = f"{layer.name}/{clean_name}"
            
            if l_class == 'LSTM':
                final_name = f"{layer.name}/lstm_cell/{clean_name.split('/')[-1] if '/' in clean_name else clean_name}"

            weight_specs.append({
                "name": final_name,
                "shape": list(arr.shape),
                "dtype": "float32"
            })
    
        if l_class == 'Conv1D':
            cfg = {
                "name": l_config['name'], "trainable": True,
                "filters": l_config['filters'], "kernel_size": l_config['kernel_size'],
                "strides": l_config['strides'], "padding": l_config['padding'],
                "data_format": "channels_last", "activation": l_config['activation'], "use_bias": l_config['use_bias']
            }
            if not tfjs_layers: cfg["batch_input_shape"] = [None, 300, 1]
            tfjs_layer["config"] = cfg
        elif l_class == 'LSTM':
            tfjs_layer["config"] = {
                "name": l_config['name'], "units": l_config['units'], "activation": l_config['activation'],
                "recurrent_activation": l_config['recurrent_activation'], "use_bias": l_config['use_bias'],
                "return_sequences": l_config['return_sequences'], "return_state": False,
                "go_backwards": False, "stateful": False, "unroll": False
            }
        elif l_class == 'MaxPooling1D':
            tfjs_layer["config"] = {
                "name": l_config['name'], "pool_size": l_config['pool_size'],
                "padding": l_config['padding'], "strides": l_config['strides'], "data_format": "channels_last"
            }
        elif l_class in ['Dense', 'Dropout']:
            tfjs_layer["config"] = l_config
        elif l_class == 'GlobalAveragePooling1D':
            tfjs_layer["config"] = {"name": l_config['name'], "data_format": "channels_last"}
        
        tfjs_layers.append(tfjs_layer)

    bin_name = "group1-shard1of1.bin"
    with open(os.path.join(output_dir, bin_name), 'wb') as f:
        for arr in weight_data_list: f.write(arr.tobytes())
            
    model_json = {
        "format": "layers-model", "generatedBy": "StepGuard Core V4",
        "modelTopology": {
            "class_name": "Sequential",
            "config": {"name": output_name, "layers": tfjs_layers},
            "keras_version": "2.15.0", "backend": "tensorflow"
        },
        "weightsManifest": [{"paths": [bin_name], "weights": weight_specs}]
    }
    with open(os.path.join(output_dir, "model.json"), 'w') as f:
        json.dump(model_json, f, indent=2)
    print(f"✅ Successfully converted {h5_path} to TFJS.")

if __name__ == "__main__":
    import os
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    for h5, name in [("../stepguard_best_model.h5", "clinical"), ("../stepguard_security_model.h5", "security")]:
        if os.path.exists(h5): convert_model(h5, name)
        else: print(f"[SKIP] {h5} not found.")
