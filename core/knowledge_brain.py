from typing import Dict, Any, List, Optional
from datetime import datetime

class KnowledgeBrain:
    """
    Knowledge Brain & Memory Plane (Layer 6)
    Manages structured episodic memory, architectural patterns,
    and cross-project organizational learnings.
    """
    def __init__(self):
        self.knowledge_base: List[Dict[str, Any]] = []

    def record_learning(
        self,
        topic: str,
        insight: str,
        category: str,
        source_agent: str,
        tags: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        entry = {
            "entry_id": f"KB-{len(self.knowledge_base) + 1:04d}",
            "topic": topic,
            "insight": insight,
            "category": category,
            "source_agent": source_agent,
            "tags": tags or [],
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        self.knowledge_base.append(entry)
        return {
            "status": "RECORDED",
            "entry": entry
        }

    def search_knowledge(self, query: str, category: Optional[str] = None) -> List[Dict[str, Any]]:
        results = []
        q = query.lower()
        for item in self.knowledge_base:
            if category and item["category"] != category:
                continue
            if q in item["topic"].lower() or q in item["insight"].lower():
                results.append(item)
        return results
