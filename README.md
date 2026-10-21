# Lung Risk Lens

One app, two views. No raw data table is shown anywhere.

- **Risk check**: live 0-100 risk score from your answers. The score is the average of two models, LightGBM and K-Means SMOTE + MLP, with each model's score shown. Shows model agreement, percentile, what moves the score, closest matches in the data, next steps, pin-and-compare, and a copyable summary.
- **Analytics** (Power BI style, click any bar or use the slicers to filter every chart): outcome split, age histogram with mean/median/SD, outcome by age band and sex, factor lift, symptom burden, prevalence, correlation heatmap, ranked correlations, top-signal panels, dataset health, auto-written insights.

## Run
    python3 -m http.server 8000      # inside this folder
    open http://localhost:8000

## Live data
Replace `data/lung_cancer.csv`: the page checks every 4 seconds and recomputes charts, models and scores.
Or use **Data** (top right) to load a CSV, drop a file on the page, or add a record from the Risk check answers and watch everything update.
Required columns: GENDER, AGE, SMOKING, YELLOW_FINGERS, ANXIETY, PEER_PRESSURE, CHRONIC DISEASE, FATIGUE, ALLERGY, WHEEZING, ALCOHOL CONSUMING, COUGHING, SHORTNESS OF BREATH, SWALLOWING DIFFICULTY, CHEST PAIN, LUNG_CANCER. Both 0/1 and Kaggle 1/2 coding work. Duplicate rows are removed by default.

## Notes
Both models train live in the browser. LightGBM is a Python/C++ library, so the page uses a JavaScript gradient-boosted-tree implementation with the same approach (leaf-wise Newton boosting, class weights). K-Means SMOTE is implemented for real (k-means clusters, SMOTE inside sparse clusters) feeding a small MLP. Score tiers: under 35 lower, 35-65 moderate, 65+ higher. Screening aid only, not a diagnosis.

## Files
index.html, styles.css, ml.js (models), app.js (UI), data/lung_cancer.csv, dist/lung-risk-lens.html (single file with data embedded; rebuild with `python3 build_single.py`).
