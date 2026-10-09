"""Create a runnable demonstration artifact, not a validated production model."""
from pathlib import Path
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline


def train(path="models/classifier.joblib"):
    texts = [
        "Python software API programming cloud application", "machine learning model data engineering",
        "React JavaScript developer database technology", "open source framework neural network",
        "company sales revenue customers business market", "business consulting strategy growth",
        "enterprise products commercial operations company", "marketing finance management services",
        "university course education students teaching", "academic research school learning curriculum",
        "college degree lecture classroom professor", "tutorial lesson training educational program",
    ]
    labels = ["technology"] * 4 + ["business"] * 4 + ["education"] * 4
    model = make_pipeline(TfidfVectorizer(), LogisticRegression(random_state=42))
    model.fit(texts, labels)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "version": "demo-tfidf-v1", "demo": True}, path)


if __name__ == "__main__":
    train()
