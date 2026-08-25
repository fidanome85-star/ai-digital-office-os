import hashlib
import json
from datetime import datetime
from typing import Dict, Any, List, Optional
from gateway.adapters.file_sandbox import FileSandboxAdapter

class ArtifactManager:
    """
    Artifact Plane & Version Control Manager (Layer 6)
    Maintains cryptographic checksums, version history, and structured metadata
    for all artifacts generated across departmental agent workflows.
    """
    def __init__(self, sandbox_adapter: Optional[FileSandboxAdapter] = None):
        self.sandbox = sandbox_adapter or FileSandboxAdapter()
        self.manifest_path = "manifests/artifact_manifest.json"

    def _compute_hash(self, content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def store_artifact(
        self,
        artifact_id: str,
        name: str,
        category: str,
        content: str,
        created_by_agent: str,
        version: int = 1
    ) -> Dict[str, Any]:
        file_path = f"{category}/{name}"
        checksum = self._compute_hash(content)
        
        # Write content safely to sandbox
        write_result = self.sandbox.write_file(file_path, content)
        if write_result.get("status") != "SUCCESS":
            return write_result

        metadata = {
            "artifact_id": artifact_id,
            "name": name,
            "category": category,
            "file_path": file_path,
            "version": version,
            "checksum_sha256": checksum,
            "created_by": created_by_agent,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        return {
            "status": "STORED",
            "metadata": metadata
        }
