# IP Character Vault — Hybrid / No Paid AI API Edition

## v2.1 identity-first upgrade

Balanced and Studio now render an identity pack first, score both generated
anchors locally, and wait for visual approval before rendering the remaining
panels. Results use explicit `passed`, `failed`, `unscored`, or
`not_applicable` states; a missing score is never reported as a pass. Source
face details use detected landmarks, while the original reference is contained
without a destructive fixed crop. See `DEPLOY_V2.1.md` for the Windows update.

**A working application source package**, not an already-deployed service. Premium static frontend on Netlify, authenticated serverless proxy, and an independent Python worker that runs inference through local Ollama and ComfyUI. The worker can optionally call a compatible Gradio Space for image generation instead of local ComfyUI.

### What is actually free?

- Frontend: fits Netlify Free within its published limits (subject to plan changes / credit quotas).
- Ollama + compatible open-weight vision model: no per-request API charges when running on your hardware.
- ComfyUI + compatible freely licensed checkpoint: no per-request API charges when running on your own GPU; **your own hardware and electricity are not free**.
- Optional third-party public/community Gradio Space: can have limited free quota, queues or outages, and may require its own account/token; **no guaranteed free GPU or model access**.
- Cloudflare Tunnel: a free tier is available for connecting the local worker to your Netlify app. A stable hostname typically needs a domain on Cloudflare; temporary Quick Tunnel addresses are development-only.

This package avoids the `OPENAI_API_KEY`, `LOVABLE_API_KEY`, `invalid_issuer`, and `vision_parse_failed` paid-provider configuration paths by replacing them with a local inference worker. **It does not contain pretrained model weights or prebuilt hosted inference.**

## Architecture

```
Browser
  |
  | same-origin /api/jobs (image compressed to <=3 MB)
  v
Netlify static website + serverless proxy (short requests only)
  |
  | HTTPS + Bearer VAULT_WORKER_TOKEN
  v
Your FastAPI worker, via Cloudflare Tunnel or compatible HTTPS host
  |                 |
  | Ollama          | ComfyUI (or compatible free/cloud Gradio Space)
  | vision          | image-to-image generation
  +-----------------+
  |
  | Pillow: seven-section typeset PNG
  v
Netlify proxy → preview & download
```

The worker returns an immediate job ID, so Netlify does not wait for long-running GPU operations. The frontend polls job status. Netlify Functions currently have a 60s synchronous limit, 6MB buffered payload, and 20MB streamed response. Keep references small and compress them. See https://docs.netlify.com/build/functions/configuration/.

## A. Start the local AI models

1. Install [Ollama](https://ollama.com/) and download a vision model:

   ```sh
   ollama pull qwen2.5vl:3b
   ollama serve
   ```

   On some installations Ollama starts automatically; don't start a duplicate process. Use a larger model if your hardware supports it.

2. Install [ComfyUI](https://github.com/comfyanonymous/ComfyUI), install a compatible SD/SDXL checkpoint, and start it on `127.0.0.1:8188`. Set `COMFY_CHECKPOINT` to the **exact checkpoint filename** as shown in ComfyUI. The bundled default graph is generic img2img and will not guarantee identity, turnaround accuracy or reference identity consistency. For stronger fidelity, supply your own ComfyUI API workflow (e.g. with IP-Adapter / compatible reference conditioning) and set `COMFY_WORKFLOW_JSON`.

3. Install Python 3.11+ and the worker dependencies from the **folder containing this README**:

   ```sh
   python -m venv .venv
   # macOS/Linux: source .venv/bin/activate
   # Windows: .venv\\Scripts\\activate
   pip install -r worker/requirements.txt
   ```

4. Set a long random worker token and model settings (in your terminal, not in source control):

   ```sh
   export VAULT_WORKER_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(40))')"
   export OLLAMA_MODEL="qwen2.5vl:3b"
   export COMFY_CHECKPOINT="YOUR_INSTALLED_CHECKPOINT.safetensors"
   export WORKER_DATA_DIR="./private-data"
   uvicorn worker.app:app --host 127.0.0.1 --port 8765
   ```

   On Windows PowerShell use `$env:VAULT_WORKER_TOKEN="..."` instead of `export`. Use the **same worker token** in Netlify, not an OpenAI key. `worker/.env.example` documents options; the app does not automatically read `.env`.

   The worker health endpoint requires the bearer token:

   ```sh
   curl -H "Authorization: Bearer $VAULT_WORKER_TOKEN" http://127.0.0.1:8765/v1/health
   ```

## B. Expose your local worker safely

A Netlify cloud function cannot reach `http://localhost:8765` on your computer.

- Install [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/), connect a **hostname you control** to `http://127.0.0.1:8765`, and obtain the HTTPS `VAULT_WORKER_URL` (for example `https://worker.yourdomain.example/`). The tunnel creates outgoing connections—no router port forwarding. Do not expose Ollama or ComfyUI themselves.
- For temporary testing, `cloudflared tunnel --url http://127.0.0.1:8765` provides a changing Quick Tunnel URL. Not recommended for production.
- The worker rejects requests without the exact bearer token. Configure an additional Cloudflare Access policy or IP restrictions for more protection, and never publish its token.

## C. Deploy frontend on Netlify

1. Push the **extracted folder contents** into a GitHub/GitLab/Bitbucket repository. Netlify functions require a connected build; uploading only static files to the drag-and-drop deploy window does not deploy the proxy.
2. Netlify → **Add new project → Import existing project**. Build settings are in `netlify.toml`: build command `echo ...`, publish directory `web`, functions directory `netlify/functions`.
3. Configure these Netlify **site environment variables**, using the production context (Functions scope if available):

   | Name | Value |
   | --- | --- |
   | `VAULT_WORKER_URL` | HTTPS tunnel / worker URL |
   | `VAULT_WORKER_TOKEN` | The same long worker bearer secret configured locally |
   | `VAULT_ACCESS_CODE` | A **different** private password for users opening the studio |

   There is **no** `OPENAI_API_KEY` or `LOVABLE_API_KEY` needed for this edition. Do not add `VITE_` prefixes. Redeploy after changing environment variables.
4. Open your site. The app asks for your private studio access code when its first network action occurs. Upload a reference (one image), optionally enter details, and click **Generate character sheet**. The browser compresses the photo to a JPEG before passing it through Netlify.
5. For local website preview, use `npx netlify-cli dev` from the project root after setting proxy environment variables. Opening `web/index.html` directly bypasses Netlify functions and won't work for API calls.

**Security:** `VAULT_ACCESS_CODE` is a simple shared code, not user authentication. It reduces casual anonymous use but is not a multi-user account system. Before public launch, implement authenticated accounts, strict rate limits and storage/retention controls. Limit who knows the access code. Keep your local worker running to serve requests.

## D. Optional free-cloud generation

The *same local FastAPI worker* can use a hosted Gradio image-to-image Space instead of local ComfyUI. In the app, choose **Advanced controls → Image generation provider → Compatible cloud Gradio Space**, or set it as your worker default:

```sh
pip install gradio_client
export GENERATOR="gradio"
export GRADIO_SPACE_ID="owner/compatible-image-to-image-space"
export GRADIO_API_NAME="/predict"
# optional, if the Space requires authentication:
export HF_TOKEN="..."
```

The adapter calls `predict(reference_file, prompt, api_name=...)`. **Only choose a Space whose API is compatible with this two-argument contract and whose operator permits use.** Inspect its API in the Space UI; many public Spaces are incompatible, private, restricted, unavailable or queue-limited. If no compatible Space exists, use local ComfyUI. The local Ollama model still performs visual extraction. Hugging Face ZeroGPU currently includes limited free daily use for eligible accounts; it is not an unrestricted hosting service. See https://huggingface.co/docs/hub/spaces-zerogpu.

## Output and limitations

- Seven sections: profile, front/three-quarter/side/back turnaround, facial views and detail crops, eight expressions, six poses, six costume details, and palette.
- The final layout and labels are made by Pillow for legibility; not by AI-generated text.
- Full mode generates **19 variation images** (4 body views, 2 face angles, 7 expressions, 6 poses), plus source-derived crops; it can take a long time on local GPUs. Economy mode generates 11 variations, reusing images for some labels (not suitable for rigorous expression evaluation). Neither should be marketed as validated production identity lock.
- From a single photo, unseen sides, full-body geometry and costumes are reconstructed guesses. Results are *AI interpretations*, not factual biometric or wardrobe evidence. Synthetic characters in images may drift despite reference conditioning.
- The default ComfyUI graph uses generic img2img. For high-fidelity identity preservation or face-angle transformation, use a compatible reference-aware workflow and suitable model; cost and hardware needs depend on model licence.
- Results are stored on your worker machine. Process restarts lose in-memory job tracking (old PNGs stay on disk) and there is no automatic cleanup. Use this as a personal proof of concept, not a production multi-tenant service.
- Models can have their own licenses; verify commercial eligibility before deploying publicly.

## Tests

```sh
python -m unittest discover -s tests -v
node --check web/app.js
node --check netlify/functions/proxy.mjs
python -m py_compile worker/*.py
```

Tests use a fake render function and sample image, **not live AI inference**. For a real end-to-end validation, start Ollama, ComfyUI and the tunnel, deploy Netlify, and run one image-only job.

### Version

Hybrid prototype v1.0 (November 2026); independent build, preserves IP Character Vault concept and seven-section functional requirements. It does not silently modify your existing Netlify site or Lovable project. Existing Netlify files need to be replaced with this source through a Git-based deployment.

## Hybrid v2.0 quality upgrade (November 2026)

**See [`SETUP_STUDIO.md`](SETUP_STUDIO.md) for Windows setup and exact ComfyUI dependencies.** The new UI has three generation modes:

- **Economy**: retains the original generic img2img baseline. It deliberately marks reused images; low cost and limited accuracy.
- **Balanced**: uses a real SDXL InstantID face-conditioning graph **plus independent SDXL OpenPose ControlNet** with full-height latent frames and synthetic pose guides. The worker builds a face-angle identity pack and uses it for the remaining sections. It will **fail clearly** if InstantID/SDXL OpenPose nodes or weights are missing, rather than claim fidelity from generic img2img.
- **Studio**: Balanced plus an optional local InsightFace facial similarity reviewer, selective rerendering (up to two retries for panels failing quality checks), and metadata shown in the output. Face scores are only heuristics.

The board now uses **contained, tall full-body tiles**, crops real source photograph regions for material references, extracts a non-repeating palette from actual photograph pixels, and labels *inferred* full-body and back views. It does **not** fabricate factual unseen details. The same Netlify project, tunnel URL, worker bearer token, Ollama service, and ComfyUI server can be reused; update both Windows worker source and the Git-connected Netlify source. The project does not contain InstantID/ControlNet model weights.

Quick local readiness check after setting the new model environment variables:

```powershell
cd 'C:\AI\WorkProjects\IP-Character-Vault-Hybrid'
.\.venv\Scripts\python.exe -m worker.doctor
```

The source package was tested with fake/mocked ComfyUI responses. **Real local SDXL + InstantID + OpenPose GPU inference and hosted Netlify deployment have not been verified in this environment.**
