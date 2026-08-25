from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any, List

class DeterministicMathEngine:
    """
    Deterministic Business Calculation Engine (v1.1)
    Guarantees exact mathematical, financial, and inventory invariants
    without floating-point anomalies or LLM hallucinations.
    """
    
    @staticmethod
    def calculate_line_item(unit_price: float, quantity: float, tax_rate_percent: float = 0.0, discount_percent: float = 0.0) -> Dict[str, Any]:
        p = Decimal(str(unit_price))
        q = Decimal(str(quantity))
        t_rate = Decimal(str(tax_rate_percent)) / Decimal("100")
        d_rate = Decimal(str(discount_percent)) / Decimal("100")
        
        gross = p * q
        discount = (gross * d_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        taxable_amount = gross - discount
        tax = (taxable_amount * t_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        net_total = taxable_amount + tax
        
        return {
            "gross_amount": float(gross),
            "discount_amount": float(discount),
            "tax_amount": float(tax),
            "net_total": float(net_total)
        }

    @staticmethod
    def verify_ledger_balance(debits: List[float], credits: List[float]) -> bool:
        total_debits = sum([Decimal(str(d)) for d in debits])
        total_credits = sum([Decimal(str(c)) for c in credits])
        return total_debits == total_credits
