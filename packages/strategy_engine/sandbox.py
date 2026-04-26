from __future__ import annotations

import ast


MAX_CODE_LENGTH = 25000
MAX_AST_NODES = 4000
FORBIDDEN_CALLS = {
    "eval",
    "exec",
    "compile",
    "open",
    "input",
    "globals",
    "locals",
    "vars",
    "getattr",
    "setattr",
    "delattr",
    "breakpoint",
}
FORBIDDEN_ATTRIBUTES = {
    "__dict__",
    "__class__",
    "__bases__",
    "__subclasses__",
    "__globals__",
    "__code__",
    "__closure__",
}


class StrategySafetyVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.node_count = 0

    def generic_visit(self, node):
        self.node_count += 1
        if self.node_count > MAX_AST_NODES:
            raise ValueError("Strategy is too complex for the current sandbox limits.")
        super().generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name not in {"math", "statistics", "numpy", "pandas", "backtesting"}:
                raise ValueError(f"Import '{alias.name}' is not allowed in Strategy Lab.")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module not in {"math", "statistics", "numpy", "pandas", "backtesting", "backtesting.lib"}:
            raise ValueError(f"Import from '{node.module}' is not allowed in Strategy Lab.")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
            raise ValueError(f"Call to '{node.func.id}' is not allowed in Strategy Lab.")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in FORBIDDEN_ATTRIBUTES:
            raise ValueError(f"Attribute '{node.attr}' is not allowed in Strategy Lab.")
        self.generic_visit(node)


def validate_strategy_code(strategy_code: str) -> None:
    code = strategy_code or ""
    if not code.strip():
        raise ValueError("Strategy code is empty.")
    if len(code) > MAX_CODE_LENGTH:
        raise ValueError("Strategy code exceeds the current sandbox size limit.")

    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise ValueError(f"Strategy syntax error: {exc.msg}") from exc

    has_strategy_class = False
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                if isinstance(base, ast.Name) and base.id == "Strategy":
                    has_strategy_class = True
                if isinstance(base, ast.Attribute) and base.attr == "Strategy":
                    has_strategy_class = True

    if not has_strategy_class:
        raise ValueError("Strategy code must define a class that inherits from backtesting.Strategy.")

    StrategySafetyVisitor().visit(tree)
