# Memory Service
Three tiers per clause 47: working_memory_cache (TTL'd), memory_facts
(durable), memory_embeddings (pgvector/HNSW). Route reads by access pattern
— do not send every lookup through vector search.
