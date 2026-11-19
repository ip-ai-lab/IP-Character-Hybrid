# IP Character Vault Hybrid v2.1 — Windows quality and performance upgrade

This upgrade keeps **Netlify + Cloudflare Tunnel + FastAPI worker + Ollama + ComfyUI**. No paid OpenAI API is required. It does **not** include model weights, pretrained InsightFace models, or commercial use rights. **The code has been tested with simulated ComfyUI responses, not with your actual local GPU**; follow these steps to make Balanced and Studio functional.

## 0. Replace the app without losing your secrets

Back up `C:\AI\WorkProjects\IP-Character-Vault-Hybrid`. Stop the Python worker (`Ctrl+C`). Extract this ZIP into the existing project folder, overwriting source files; retain `.venv` and `private-data` (neither is in this ZIP). Keep the original Netlify `VAULT_WORKER_TOKEN` and `VAULT_ACCESS_CODE` unchanged. The tunnel can stay running on port **8766** while the worker restarts on that port.

The static frontend and `netlify/functions/proxy.mjs` **must also be updated** on your Git-connected Netlify deployment; uploading the ZIP into Windows does **not** update the hosted website automatically. Commit/push `web/`, `netlify/`, `netlify.toml` and docs to the linked repository, then redeploy Netlify. Do not add your worker token to the repo.

## 1. Installed model you already have

Recommended compatible base checkpoint:

`sd_xl_base_1.0.safetensors`

Already recognized by ComfyUI `CheckpointLoaderSimple` on your PC. Keep using it for Economy and as the SDXL model for Balanced/Studio.

### New dependencies for Balanced/Studio

**InstantID nodes:** https://github.com/cubiq/ComfyUI_InstantID

Install via ComfyUI Manager or clone into `C:\AI\Apps\ComfyUI\ComfyUI\custom_nodes`. Install dependencies into the **Python interpreter running ComfyUI**, not just the Vault `.venv`. The InstantID repo documents `insightface`/`onnxruntime` requirements.

InstantID requires three distinct components (verify licences and download instructions at the repository):
- **SDXL InstantID adapter weights** under a ComfyUI-registered `instantid` model folder, often `ip-adapter.bin`.
- **InstantID-compatible ControlNet weights** under `controlnet` (separate from OpenPose weights).
- **InsightFace antelopev2 weights** in the ComfyUI InsightFace models directory (`models/insightface/models/antelopev2` in the InstantID extension documentation). Note: these weights may have licence restrictions for commercial use.

**Pose guidance:** Install a real **SDXL-compatible OpenPose ControlNet** model under ComfyUI's registered `controlnet` models folder. SD1.5 OpenPose ControlNet weights are **not** compatible with SDXL. The worker draws approximate OpenPose-style skeleton hints for each requested view and full-body pose. Those are generated pose guides, not extracted ground-truth keypoints.

The worker uses standard **built-in ComfyUI** `ControlNetLoader` and `ControlNetApplyAdvanced` nodes in addition to the InstantID extension nodes. Separate `comfyui_controlnet_aux` preprocessors are **optional** for future real pose detection, not required by this synthetic-guide workflow.

## 2. Register model paths (only if needed)

Your checkpoints are already visible, but the newly downloaded models must be visible to ComfyUI. You may put them in ComfyUI's native model folders or use `extra_model_paths.yaml` with folders under `C:/AI/models/Image`. Example only — don't overwrite your existing YAML mapping:

```yaml
vault_quality_models:
  base_path: C:/AI/models/Image
  instantid: InstantID
  controlnet: ControlNet
```

After restarting ComfyUI, run the following in PowerShell to inspect exact filenames:

```powershell
$base = 'http://127.0.0.1:8188/object_info/'
(Invoke-RestMethod ($base + 'InstantIDModelLoader')).InstantIDModelLoader.input.required.instantid_file[0]
(Invoke-RestMethod ($base + 'ControlNetLoader')).ControlNetLoader.input.required.control_net_name[0]
(Invoke-RestMethod ($base + 'ApplyInstantID')).ApplyInstantID.class_type
```

If a request gives HTTP 404 or missing class name, the required extension is not installed or ComfyUI has not been restarted.

## 3. Set worker environment variables

Use the **same PowerShell window** where you previously created `VAULT_WORKER_TOKEN` and configured Ollama/ComfyUI. Replace the three **model-name placeholders** below with the exact strings returned by `/object_info`. Do not guess filenames.

```powershell
cd 'C:\AI\WorkProjects\IP-Character-Vault-Hybrid'
$env:COMFY_URL = 'http://127.0.0.1:8188'
$env:OLLAMA_URL = 'http://127.0.0.1:11434'
$env:OLLAMA_MODEL = 'qwen2.5vl:3b'
$env:COMFY_CHECKPOINT = 'sd_xl_base_1.0.safetensors'
$env:GENERATOR = 'comfyui'
$env:INSTANTID_MODEL = 'EXACT_INSTANTID_FILENAME_FROM_COMFYUI'
$env:INSTANTID_CONTROLNET = 'EXACT_INSTANTID_CONTROLNET_FILENAME_FROM_COMFYUI'
$env:OPENPOSE_CONTROLNET = 'EXACT_SDXL_OPENPOSE_FILENAME_FROM_COMFYUI'
$env:INSTANTID_PROVIDER = 'CPU'
$env:WORKER_DATA_DIR = 'C:\AI\WorkProjects\IP-Character-Vault-Hybrid\private-data'
.\.venv\Scripts\python.exe -m worker.doctor
```

If `doctor` reports missing nodes or models, **Balanced/Studio will not run**. Economy remains available. No silent downgrade happens.

## 4. Studio mode reviewer (optional extra dependency)

Studio compares detected face embeddings with the original reference using a **local** InsightFace model and rerenders poorly matching panels up to **two additional times**. The threshold defaults to `0.38` and is only a heuristic, not an accuracy or identity guarantee. Full-body back views are geometry-reviewed only (a face should not appear).

Install packages into the **Vault worker `.venv`** (not the ComfyUI interpreter):

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\worker\requirements-quality.txt
```

InsightFace can require C++ build tools on Windows and may be difficult to install. A supported wheel or build tools may be needed for Python 3.12. Use only trusted installation sources. Set `INSIGHTFACE_ROOT` to the directory containing `models/antelopev2` if it is not in the default path:

```powershell
$env:INSIGHTFACE_MODEL = 'antelopev2'
$env:INSIGHTFACE_ROOT = 'C:\AI\Apps\ComfyUI\ComfyUI\models\insightface'
$env:STUDIO_FACE_THRESHOLD = '0.38'
```

The worker refuses Studio mode with a clear error when the reviewer cannot load or detect a face in the original reference. This is intentional: it does not pretend to have performed identity verification.

## 5. Restart the worker and keep Netlify connection

```powershell
.\.venv\Scripts\python.exe -m uvicorn worker.app:app --host 127.0.0.1 --port 8766
```

Keep this worker terminal open. Your Cloudflare Quick Tunnel should continue to point to `http://127.0.0.1:8766`. If the tunnel is restarted, update `VAULT_WORKER_URL` in Netlify and redeploy. Your secrets should remain unchanged unless you rotated the token.

After pushing the frontend to Netlify and deploying, test in this order:

1. **Economy** with one small JPEG (verify old workflow still works).
2. **Balanced** with a clear frontal face reference, full body checked for head and feet, facial continuity checked by eye.
3. **Studio** only after local reviewer is successfully installed, check `Consistency review` in the generated app result. A panel can be flagged even after retries; this is not a false pass.

Use `python -m unittest discover -s tests -v` and `node --check web/app.js` for offline tests. **A localhost screenshot and these tests do not prove real GPU generation.**

## Quality limitations and rights

- A **single headshot cannot supply accurate full-body geometry or unseen clothing/back views**; the new sheet labels inferred views accordingly. Add more reference views when available.
- The composer uses actual source-image crops for garment and identity-detail *regions*, but does not claim precisely detected anatomical landmarks. Colour swatches are sampled directly from the input image, not invented by the language model.
- The synthetic pose maps approximate OpenPose keypoints. For higher quality, provide real OpenPose ControlNet pose maps matched to the desired framing; body proportions remain model estimates.
- InstantID / IP-Adapter and pretrained InsightFace models may have independent licence terms. Check commercial use rights before monetizing the app.
- Studio comparisons are automated local heuristics. Human review remains important. Review only images you have the rights to use.
