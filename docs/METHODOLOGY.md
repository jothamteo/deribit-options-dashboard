# Methodology

This document derives every formula computed in the dashboard. It is written for someone who knows Black-Scholes and basic options microstructure but wants to verify the implementation matches their understanding. Honest about assumptions; explicit about limitations.

---

## 1. Black-Scholes greeks

Inputs: spot $S$, strike $K$, time-to-expiry $T$ (years), implied vol $\sigma$, risk-free rate $r$, dividend yield $q$. For BTC we set $r = q = 0$; see §1.4 below.

$$d_1 = \frac{\ln(S/K) + (r - q + \sigma^2/2)\,T}{\sigma\sqrt{T}}, \qquad d_2 = d_1 - \sigma\sqrt{T}$$

### 1.1 Gamma

$$\Gamma = \frac{e^{-qT}\,\varphi(d_1)}{S\sigma\sqrt{T}}$$

where $\varphi$ is the standard normal pdf. With $q = 0$ this reduces to $\varphi(d_1) / (S\sigma\sqrt{T})$, which is what `bsGamma()` implements in `js/black_scholes.js`.

### 1.2 Delta (call / put)

$$\Delta_{\text{call}} = e^{-qT}\,N(d_1), \qquad \Delta_{\text{put}} = e^{-qT}\,(N(d_1) - 1)$$

We need $\Delta$ to find the $25\Delta$ put and call for risk-reversal / butterfly construction. Deribit's `/public/get_book_summary_by_currency` does not return greeks, so we compute locally rather than burn an HTTP call per instrument.

### 1.3 Implementation note — N(x)

We use the Abramowitz-Stegun approximation 26.2.17 for $N(x)$ (max error $< 7.5 \times 10^{-8}$), which is sufficient for IV space.

### 1.4 Why $r = 0$ for BTC

There is no canonical risk-free rate for crypto. Using a USD T-bill rate distorts forwards because the basis isn't financed at T-bill — it's financed at perpetual funding. Using a perp-funding-derived rate is unstable (negative on bear days, positive on bull days, mean-reverting on hours). Using $r = 0$ pushes the basis information into $F$ instead, where we compute it from observed Deribit futures prices. This is cleaner and more defensible than picking an arbitrary rate.

---

## 2. Forward F per expiry

For each option expiry $t_i$, we set the forward $F_i$ to the mark price of the BTC future expiring at the same timestamp. If no listed future matches the option expiry exactly (rare — Deribit aligns these), we linearly interpolate the futures curve in time.

This is critical for the SVI fit: log-moneyness is $k = \ln(K / F_i)$, not $\ln(K / S)$. Using spot would bias $k$ by the basis, which drifts smoothly in time and would shift every smile horizontally without changing its shape — but term-structure comparisons across expiries would become noisy.

---

## 3. Dealer Gamma Exposure (GEX)

### 3.1 Per-option contribution

$$\text{GEX}_i = \Gamma_i \cdot \text{OI}_i \cdot \text{contractSize} \cdot S^2 \cdot 0.01 \cdot \epsilon_i$$

where $\epsilon_i = +1$ for calls and $\epsilon_i = -1$ for puts (SqueezeMetrics canonical assumption: dealers are net short calls, net long puts).

The factor $S^2 \cdot 0.01$ converts $\Gamma$ (dollar-gamma per share per dollar move) to the conventional GEX unit — dollar gamma per 1% spot move.

For Deribit BTC options, `contractSize = 1 BTC`. OI is reported in contracts, so the product is already in BTC-denominated dollar exposure.

### 3.2 Aggregate by strike and zero-gamma flip

We sum $\text{GEX}_i$ across every live option at each strike, regardless of expiry, to get $\text{GEX}(K)$. The flip level is found by recomputing total GEX at hypothetical spot levels $S \in [0.80\,S_0, 1.20\,S_0]$ in 0.5% steps and locating the sign change. The flip is the spot at which dealers stop suppressing volatility (above flip → dealers long gamma → suppress; below → short gamma → amplify).

### 3.3 Honest limits

- The SqueezeMetrics sign assumption was derived from SPX dealer flow circa 2015–2017. Deribit's user mix is materially different — more prop, more directional retail, fewer market-making banks. The sign of dealer positioning is genuinely less certain.
- We surface this in the README and let the operator weigh the conclusions.
- An honest version of this dashboard for Deribit would estimate dealer position from market-maker quoting behavior. That's outside scope for a static portfolio piece.

Citation: SqueezeMetrics, _The Implied Order Book and Gamma Exposure_, 2017.

---

## 4. SVI implied vol surface

### 4.1 Raw parameterization (Gatheral 2004)

For a single expiry $T$, total variance $w(k) = \sigma^2_{\text{IV}}(k) \cdot T$ is fit as

$$w(k) = a + b\bigl(\rho\,(k - m) + \sqrt{(k - m)^2 + \sigma^2}\bigr)$$

with five parameters $\{a, b, \rho, m, \sigma\}$ per expiry. Convex in $k$ when $b \ge 0$, $|\rho| < 1$, $\sigma > 0$.

### 4.2 Fitting

For each expiry we minimize

$$L(\theta) = \sum_i \bigl(w_i^{\text{market}} - w(k_i;\theta)\bigr)^2 + \lambda \cdot P(\theta)$$

where the penalty $P(\theta)$ enforces:

| Constraint | Penalty term |
|---|---|
| $b \ge 0$ | $\max(0, -b)^2$ |
| $|\rho| < 1$ | $\max(0, |\rho| - 0.999)^2$ |
| $\sigma > 0$ | $\max(0, 10^{-6} - \sigma)^2$ |
| $a + b\sigma\sqrt{1-\rho^2} \ge 0$ | $\max(0, -(a + b\sigma\sqrt{1-\rho^2}))^2$ |

Optimizer: Nelder-Mead simplex, hand-implemented in `js/svi.js`. Initial simplex seeded from market-implied moments: $m_0 = \text{argmin}_k\,w_i$, $a_0 = \min_i w_i$, $b_0 = $ rough slope, $\rho_0 = -0.3$, $\sigma_0 = 0.1$.

### 4.3 Honest limits

- For very short-dated expiries (< 24h) the smile is dominated by gamma-kink dynamics and the SVI form fits poorly. Fit residuals are exposed in the per-expiry slice charts so the operator can see when the fit is unreliable.
- Multi-expiry no-arbitrage (calendar / butterfly across expiries) is **not** enforced. We fit each expiry independently. This is the standard "raw SVI" practice; SSVI / surface SVI exists but is overkill for visual purposes.

Citation: Gatheral, J., _A parsimonious arbitrage-free implied volatility parameterization_, 2004.

---

## 5. ATM IV term structure

For each expiry $T_i$ with fitted SVI parameters $\theta_i$, ATM IV is

$$\sigma_{\text{ATM}}(T_i) = \sqrt{w(0; \theta_i) / T_i}$$

i.e. evaluate the fitted total-variance curve at $k = 0$. We do **not** linearly interpolate market IVs at $k = 0$ because the at-the-money mark is not always on a listed strike (forward sits between two strikes), and using the SVI fit gives a smooth, mathematically consistent curve.

Plotted vs days-to-expiry on a log-x axis.

---

## 6. 25Δ Risk-reversal and Butterfly

For each expiry:

1. Compute $\Delta$ for every option using §1.2.
2. Find the put with $\arg\min_i |\Delta_i^{\text{put}} + 0.25|$ → call its IV $\sigma_{25\text{p}}$.
3. Find the call with $\arg\min_i |\Delta_i^{\text{call}} - 0.25|$ → call its IV $\sigma_{25\text{c}}$.
4. Compute:

$$\text{RR}_{25} = \sigma_{25\text{c}} - \sigma_{25\text{p}}$$

$$\text{BF}_{25} = \frac{\sigma_{25\text{c}} + \sigma_{25\text{p}}}{2} - \sigma_{\text{ATM}}$$

Plot RR and BF as term structures across expiries.

Convention reminder: by industry convention, "25Δ put" refers to the put whose magnitude of $\Delta$ is 0.25 — i.e., $\Delta = -0.25$. We use the absolute value when matching.

---

## 7. Max pain

For each expiry separately, candidate strikes $\{S^*\}$ are the listed strikes for that expiry. Total option-holder loss at expiry, were spot to land at $S^*$:

$$\text{pain}(S^*) = \sum_{\text{calls}} \text{OI}_c \cdot \max(0,\, S^* - K_c) + \sum_{\text{puts}} \text{OI}_p \cdot \max(0,\, K_p - S^*)$$

Max-pain strike is $\arg\min_{S^*} \text{pain}(S^*)$ — the strike at which option holders collectively lose the most (and writers, by symmetry, retain the most premium). The bar chart shows pain across all candidate strikes; the argmin is annotated.

---

## 8. OI-weighted Put/Call ratio

Per expiry and aggregate:

$$\text{P/C} = \frac{\sum_{\text{puts}} \text{OI}_p}{\sum_{\text{calls}} \text{OI}_c}$$

Reported on the context strip and per-expiry where useful.

---

## 9. Refresh and rate budget

The dashboard refreshes every 30 seconds. Per refresh:

- 1× `/public/get_index_price`
- 1× `/public/get_book_summary_by_currency?kind=option`
- 1× `/public/get_book_summary_by_currency?kind=future`
- 0× `/public/get_instruments?kind=option` (cached in sessionStorage for 5 min)

Total: 3 HTTP requests per 30s = 0.1 req/s, well under Deribit's public-tier limit. The header surfaces the cumulative call counter so the operator (or reviewer) can verify the budget at a glance.

---

## 10. Citations

- Black, F. and Scholes, M. (1973). _The Pricing of Options and Corporate Liabilities_. Journal of Political Economy, 81(3): 637–654.
- Gatheral, J. (2004). _A parsimonious arbitrage-free implied volatility parameterization with application to the valuation of volatility derivatives_. Madrid Quant Congress.
- SqueezeMetrics (2017). _The Implied Order Book and Gamma Exposure_.
- Hull, J. C. (2017). _Options, Futures, and Other Derivatives_, 11th edition. Pearson.
- Abramowitz, M. and Stegun, I. (1964). _Handbook of Mathematical Functions_. National Bureau of Standards. (For the $N(x)$ approximation.)
