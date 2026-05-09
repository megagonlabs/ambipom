"""
Semantic similarity utilities for comparing plans at the task description level.

This module provides functions to compare plans using semantic embeddings,
complementing structural graph edit distance metrics.
"""

from typing import Any, Dict, List, Optional

import numpy as np
from sentence_transformers import SentenceTransformer, util

# Use a fast and effective model for semantic similarity
MODEL = "sentence-transformers/all-MiniLM-L6-v2"
_model: Optional[SentenceTransformer] = None


def get_model() -> SentenceTransformer:
    """Lazy load the sentence transformer model."""
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL)
    return _model


def semantic_align(
    A_texts: List[str],
    B_texts: List[str],
    *,
    top_k: int = 3,
    threshold: float = 0.70,
    return_matrix: bool = True,
) -> Dict[str, Any]:
    """
    Many-to-many semantic alignment between two task description lists.

    Args:
        A_texts: List of text descriptions from plan A (e.g., gold plan)
        B_texts: List of text descriptions from plan B (e.g., generated plan)
        top_k: Number of top matches to consider for each task
        threshold: Minimum similarity score to consider a match (0-1)
        return_matrix: Whether to include full similarity matrix in output

    Returns:
        Dictionary containing:
            - similarity_matrix: [[...]] (optional) - full cosine similarity matrix
            - links_A2B: {i: [(j, score), ...], ...} - matches from A to B
            - links_B2A: {j: [(i, score), ...], ...} - matches from B to A
            - coverage_A: float - fraction of A tasks with >=1 match
            - coverage_B: float - fraction of B tasks with >=1 match
            - best_mean_A2B: float - avg best match score per A task
            - best_mean_B2A: float - avg best match score per B task
            - alignment_score: float - overall alignment (avg of best_mean_A2B and best_mean_B2A)
    """
    model = get_model()

    # Handle empty inputs
    if not A_texts or not B_texts:
        return {
            "links_A2B": {},
            "links_B2A": {},
            "coverage_A": 0.0,
            "coverage_B": 0.0,
            "best_mean_A2B": 0.0,
            "best_mean_B2A": 0.0,
            "alignment_score": 0.0,
            "similarity_matrix": [] if return_matrix else None,
        }

    # Filter out empty strings
    A_valid_indices = [i for i, text in enumerate(A_texts) if text.strip()]
    B_valid_indices = [j for j, text in enumerate(B_texts) if text.strip()]
    A_filtered = [A_texts[i] for i in A_valid_indices]
    B_filtered = [B_texts[j] for j in B_valid_indices]

    # Encode with L2-normalized embeddings for cosine similarity
    EA = model.encode(A_filtered, convert_to_tensor=True, normalize_embeddings=True)
    EB = model.encode(B_filtered, convert_to_tensor=True, normalize_embeddings=True)

    # Cosine similarity matrix: shape [len(A), len(B)]
    S = util.cos_sim(EA, EB).cpu().numpy()
    nA, nB = S.shape

    # Per-node best matches
    best_A2B = S.max(axis=1) if nB else np.zeros(nA)
    best_B2A = S.max(axis=0) if nA else np.zeros(nB)
    best_mean_A2B = float(best_A2B.mean()) if nA else 0.0
    best_mean_B2A = float(best_B2A.mean()) if nB else 0.0
    alignment_score = (best_mean_A2B + best_mean_B2A) / 2.0

    # Many-to-many links via top-k + threshold
    k = max(1, min(int(top_k), nB)) if nB else 0

    # A -> B links
    links_A2B = {}
    if nB > 0:
        idx_A2B = np.argsort(-S, axis=1)[:, :k]
        val_A2B = np.take_along_axis(S, idx_A2B, axis=1)
        for i_filtered in range(nA):
            i_original = A_valid_indices[i_filtered]
            matches = [
                (
                    B_valid_indices[int(idx_A2B[i_filtered, r])],
                    float(val_A2B[i_filtered, r]),
                )
                for r in range(k)
                if val_A2B[i_filtered, r] >= threshold
            ]
            links_A2B[i_original] = matches

    # B -> A links
    k_rev = max(1, min(int(top_k), nA)) if nA else 0
    links_B2A = {}
    if nA > 0:
        idx_B2A = np.argsort(-S, axis=0)[:k_rev, :]
        val_B2A = np.take_along_axis(S, idx_B2A, axis=0)
        for j_filtered in range(nB):
            j_original = B_valid_indices[j_filtered]
            matches = [
                (
                    A_valid_indices[int(idx_B2A[r, j_filtered])],
                    float(val_B2A[r, j_filtered]),
                )
                for r in range(k_rev)
                if val_B2A[r, j_filtered] >= threshold
            ]
            links_B2A[j_original] = matches

    # Coverage: fraction of tasks with at least one match
    coverage_A = (
        float(np.mean([len(links_A2B.get(i, [])) > 0 for i in A_valid_indices]))
        if A_valid_indices
        else 0.0
    )
    coverage_B = (
        float(np.mean([len(links_B2A.get(j, [])) > 0 for j in B_valid_indices]))
        if B_valid_indices
        else 0.0
    )

    result = {
        "links_A2B": links_A2B,
        "links_B2A": links_B2A,
        "coverage_A": coverage_A,
        "coverage_B": coverage_B,
        "best_mean_A2B": best_mean_A2B,
        "best_mean_B2A": best_mean_B2A,
        "alignment_score": float(alignment_score),
    }

    if return_matrix:
        result["similarity_matrix"] = S.tolist()

    return result


def compare_plans_semantic(
    plan_A: Dict[str, Any],
    plan_B: Dict[str, Any],
    *,
    top_k: int = 3,
    threshold: float = 0.70,
) -> Dict[str, Any]:
    """
    Compare two plans semantically using task descriptions.

    Args:
        plan_A: Dictionary with 'nodes' list (e.g., gold plan)
        plan_B: Dictionary with 'nodes' list (e.g., generated plan)
        description_key: Key to extract text from each node
        top_k: Number of top matches to consider
        threshold: Minimum similarity threshold

    Returns:
        Semantic alignment results from semantic_align()
    """
    A_texts = [node.task for node in plan_A.get("nodes", [])]
    B_texts = [node.task for node in plan_B.get("nodes", [])]

    return semantic_align(A_texts, B_texts, top_k=top_k, threshold=threshold)


def compute_task_level_metrics(
    gold_plan: Dict[str, Any],
    generated_plan: Dict[str, Any],
    *,
    threshold: float = 0.70,
) -> Dict[str, float]:
    """
    Compute task-level semantic metrics for plan comparison.

    Useful for evaluation: measures how well the generated plan covers
    the gold plan tasks and vice versa.

    Args:
        gold_plan: Ground truth plan
        generated_plan: Plan to evaluate
        description_key: Key to extract text from nodes
        threshold: Minimum similarity for a match

    Returns:
        Dictionary with metrics:
            - recall: % of gold tasks covered by generated plan
            - precision: % of generated tasks that align with gold
            - f1_score: Harmonic mean of recall and precision
            - alignment_score: Overall semantic alignment
    """
    result = compare_plans_semantic(gold_plan, generated_plan, threshold=threshold)

    recall = result["coverage_A"]  # Coverage of gold tasks
    precision = result["coverage_B"]  # Coverage of generated tasks

    f1_score = 0.0
    if recall + precision > 0:
        f1_score = 2 * (recall * precision) / (recall + precision)

    return {
        "recall": recall,
        "precision": precision,
        "f1_score": f1_score,
        "alignment_score": result["alignment_score"],
    }


if __name__ == "__main__":
    # Simple test of basic functionality
    print("Testing basic semantic_align function...")

    texts_A = ["Download the dataset", "Train the model", "Evaluate accuracy"]
    texts_B = ["Fetch data files", "Build neural network", "Test model performance"]

    result = semantic_align(texts_A, texts_B, top_k=2, threshold=0.60)

    print(f"\nCoverage A: {result['coverage_A']:.3f}")
    print(f"Coverage B: {result['coverage_B']:.3f}")
    print(f"Alignment score: {result['alignment_score']:.3f}")

    print("\nLinks A -> B:")
    for i, links in result["links_A2B"].items():
        print(
            f"  '{texts_A[i]}' -> {[(texts_B[j], f'{score:.3f}') for j, score in links]}"
        )

    print("\nTest completed!")
