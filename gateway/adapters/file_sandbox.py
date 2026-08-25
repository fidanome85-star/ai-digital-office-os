import os
from typing import Dict, Any, List

class FileSandboxAdapter:
    """
    File Sandbox Adapter (Layer 5)
    Restricts file system read/write operations strictly within the authorized sandbox directory.
    Prevents directory traversal and unauthorized core system overrides.
    """
    def __init__(self, sandbox_root: str = "artifacts"):
        self.sandbox_root = os.path.abspath(sandbox_root)
        if not os.path.exists(self.sandbox_root):
            os.makedirs(self.sandbox_root, exist_ok=True)

    def _is_safe_path(self, target_path: str) -> bool:
        full_path = os.path.abspath(os.path.join(self.sandbox_root, target_path))
        return os.path.commonpath([self.sandbox_root]) == os.path.commonpath([self.sandbox_root, full_path])

    def write_file(self, relative_path: str, content: str) -> Dict[str, Any]:
        if not self._is_safe_path(relative_path):
            return {
                "status": "DENIED",
                "error": "Directory traversal attempt detected. Operation aborted."
            }
        
        full_path = os.path.abspath(os.path.join(self.sandbox_root, relative_path))
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
            
        return {
            "status": "SUCCESS",
            "path": full_path,
            "bytes_written": len(content.encode("utf-8"))
        }

    def read_file(self, relative_path: str) -> Dict[str, Any]:
        if not self._is_safe_path(relative_path):
            return {
                "status": "DENIED",
                "error": "Directory traversal attempt detected. Operation aborted."
            }
            
        full_path = os.path.abspath(os.path.join(self.sandbox_root, relative_path))
        if not os.path.exists(full_path):
            return {
                "status": "ERROR",
                "error": f"File not found: {relative_path}"
            }
            
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        return {
            "status": "SUCCESS",
            "content": content
        }
