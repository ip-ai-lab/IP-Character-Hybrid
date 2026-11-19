# IP Character Vault Hybrid v2.1 deployment guide

This update preserves the existing Netlify → Cloudflare Tunnel → FastAPI
worker → Ollama/ComfyUI architecture. It does not contain model weights or
secrets.

## 1. Back up and replace source

Stop the worker with `Ctrl+C`. Back up
`C:\AI\WorkProjects\IP-Character-Vault-Hybrid`, then extract the v2.1 ZIP
and copy its source over that folder. Preserve the existing `.venv`,
`private-data`, local `.env`, ComfyUI installation, and model files.

## 2. Update the worker environment

```powershell
cd "C:\AI\WorkProjects\IP-Character-Vault-Hybrid"
.\.venv\Scripts\python.exe -m pip install -r .\worker\requirements-quality.txt
```

The requirement deliberately uses InsightFace 2.1 or newer. Official 0.7.3 was
published as source only and makes Windows try to compile a C++ extension.
InsightFace 2.1 publishes a platform-independent wheel and does not require
Visual C++ Build Tools for the FaceAnalysis workflow used here.

If an earlier v2.1 package attempted to install 0.7.3 and failed, run:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade "insightface>=2.1,<3" "onnxruntime>=1.20,<2" "numpy>=2,<3"
```

Add the new values from `worker\.env.example` to the existing local
environment. Keep the current token. Start with 20 Balanced steps and
`CPUExecutionProvider` for identity scoring. An accelerated ONNX provider may
be evaluated separately, but this package does not claim Intel Arc, DirectML,
CUDA, or other GPU integration was validated.

Balanced and Studio now require the worker-side InsightFace model as well as
the existing ComfyUI InstantID/OpenPose models. If the reviewer is missing,
capabilities report setup required instead of silently passing panels.

## 3. Test locally

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --test .\tests\test_proxy.mjs
```

Start Ollama, ComfyUI, and the worker using the same command you already use on
port 8766.

## 4. Update GitHub and Netlify

```powershell
git add web netlify worker tests README.md SETUP_STUDIO.md DEPLOY_V2.1.md netlify.toml .gitignore
git status
git commit -m "Upgrade IP Character Vault Hybrid to v2.1"
git push origin main
```

Review `git status` first. Do not include `.env`, `.venv`, `private-data`,
generated images, model weights, or tokens. Netlify should deploy from `main`.
If a Cloudflare Quick Tunnel URL changed, update only `VAULT_WORKER_URL` in
Netlify and redeploy.

## 5. Acceptance check

Run one Balanced job with the earlier reference:

1. Original, three-quarter, and side identity images appear first.
2. Each generated anchor is `passed`, `failed`, or `unscored`.
3. Remaining panels do not render until approval.
4. Failed/unscored packs require an explicit manual override.
5. The final report shows elapsed time and flags failed/unscored panels.

Compare identity and total render time against the earlier log. The 20-step
default and caches are engineering changes, not a guaranteed speed-up; actual
results depend on the local ComfyUI graph, model loading, and hardware.

## 6. Optional validated Intel Arc identity reviewer

Intel Arc 140T testing on the target machine measured a warm average of 0.069
seconds versus the 2.029-second CPU baseline (29.26× for the tested image).
This accelerates InsightFace review only, not ComfyUI diffusion.

Install the matching OpenVINO runtime in the worker venv:

```powershell
.\.venv\Scripts\python.exe -m pip uninstall -y onnxruntime
.\.venv\Scripts\python.exe -m pip install -r .\worker\requirements-intel-gpu.txt
```

The InsightFace package may report that the distribution named `onnxruntime`
is absent; `onnxruntime-openvino` supplies the imported module in this setup.
Do not reinstall CPU `onnxruntime` afterward.

Before starting the worker:

```powershell
$env:INSIGHTFACE_PROVIDER = "OpenVINOExecutionProvider"
$env:INSIGHTFACE_DEVICE = "GPU"
$env:INSIGHTFACE_ALLOW_CPU_FALLBACK = "1"
```

The worker discovers `openvino.dll` inside the active venv automatically.
After the first reference initializes the engine, `/v1/health` reports
`active_provider`, each model's provider list, and any CPU fallback reason.
Keep fallback enabled initially; a failed GPU load remains functional but is
reported honestly as CPU.
