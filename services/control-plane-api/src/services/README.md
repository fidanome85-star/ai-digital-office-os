# Business Logic
One module per domain area, calling into packages/db via domain-model types.
Keep this layer free of HTTP concerns — routes/ should be a thin layer over this.
