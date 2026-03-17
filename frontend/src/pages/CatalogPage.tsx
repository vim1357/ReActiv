import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { getCatalogFilters, getCatalogItems } from "../api/client";
import {
  BOOLEAN_FILTER_KEYS,
  FILTER_LABELS,
  INITIAL_RANGES,
  RANGE_FILTER_KEYS,
  SORT_OPTIONS,
  STRING_FILTER_KEYS,
  type RangeFilters,
  type SelectedFilters,
} from "../catalog/config";
import type {
  CatalogFiltersResponse,
  CatalogListItem,
  CatalogItemsResponse,
} from "../types/api";

function formatNumberValue(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return value.toLocaleString("ru-RU");
}

export function CatalogPage() {
  const [filters, setFilters] = useState<CatalogFiltersResponse | null>(null);
  const [itemsResponse, setItemsResponse] = useState<CatalogItemsResponse | null>(
    null,
  );
  const [selectedFilters, setSelectedFilters] = useState<SelectedFilters>(
    {} as SelectedFilters,
  );
  const [rangeFilters, setRangeFilters] = useState<RangeFilters>(INITIAL_RANGES);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function loadFilters() {
      try {
        const data = await getCatalogFilters();
        setFilters(data);
      } catch {
        setError("Не удалось загрузить фильтры");
      }
    }

    void loadFilters();
  }, []);

  const query = useMemo(() => {
    const queryObject: Record<string, string | string[] | number> = {
      page,
      pageSize,
      sortBy,
      sortDir,
    };

    if (search.trim()) {
      queryObject.search = search.trim();
    }

    for (const key of [...STRING_FILTER_KEYS, ...BOOLEAN_FILTER_KEYS]) {
      const values = selectedFilters[key];
      if (values && values.length > 0) {
        queryObject[key] = values;
      }
    }

    for (const key of RANGE_FILTER_KEYS) {
      const value = rangeFilters[key];
      if (value !== "") {
        queryObject[key] = Number(value);
      }
    }

    return queryObject;
  }, [page, pageSize, rangeFilters, search, selectedFilters, sortBy, sortDir]);

  useEffect(() => {
    async function loadItems() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await getCatalogItems(query);
        setItemsResponse(response);
      } catch {
        setError("Не удалось загрузить каталог");
      } finally {
        setIsLoading(false);
      }
    }

    void loadItems();
  }, [query]);

  const items: CatalogListItem[] = itemsResponse?.items ?? [];
  const total = itemsResponse?.pagination.total ?? 0;
  const hasImportedData = total > 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedBrands = selectedFilters.brand ?? [];

  const availableModelOptions = useMemo(() => {
    if (!filters) {
      return [];
    }

    if (selectedBrands.length === 0) {
      return filters.model;
    }

    const modelSet = new Set<string>();
    selectedBrands.forEach((brand) => {
      (filters.modelsByBrand?.[brand] ?? []).forEach((model) => {
        modelSet.add(model);
      });
    });

    return Array.from(modelSet).sort((a, b) => a.localeCompare(b, "ru"));
  }, [filters, selectedBrands]);

  function clearFilters(): void {
    setSelectedFilters({} as SelectedFilters);
    setRangeFilters(INITIAL_RANGES);
    setSearch("");
    setPage(1);
  }

  return (
    <section>
      <h1>Каталог</h1>
      {error && <p className="error">{error}</p>}

      <div className="catalog-layout">
        <aside className="panel filters">
          <h2>Фильтры</h2>
          {filters ? (
            <>
              {STRING_FILTER_KEYS.map((key) => (
                <label key={key} className="field">
                  <span>{FILTER_LABELS[key]}</span>
                  <select
                    multiple
                    disabled={
                      key === "model" &&
                      selectedBrands.length > 0 &&
                      availableModelOptions.length === 0
                    }
                    value={selectedFilters[key] ?? []}
                    onChange={(event) => {
                      const values = Array.from(
                        event.target.selectedOptions,
                      ).map((option) => option.value);
                      setPage(1);
                      if (key === "brand") {
                        const modelSet = new Set<string>();
                        values.forEach((brand) => {
                          (filters?.modelsByBrand?.[brand] ?? []).forEach((model) => {
                            modelSet.add(model);
                          });
                        });

                        setSelectedFilters((previous) => {
                          const previousModels = previous.model ?? [];
                          const nextModels =
                            values.length === 0
                              ? previousModels
                              : previousModels.filter((model) => modelSet.has(model));

                          return {
                            ...previous,
                            brand: values,
                            model: nextModels,
                          };
                        });
                        return;
                      }

                      setSelectedFilters((previous) => ({
                        ...previous,
                        [key]: values,
                      }));
                    }}
                  >
                    {(key === "model" ? availableModelOptions : filters[key]).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

              {BOOLEAN_FILTER_KEYS.map((key) => (
                <label key={key} className="field">
                  <span>{FILTER_LABELS[key]}</span>
                  <select
                    multiple
                    value={selectedFilters[key] ?? []}
                    onChange={(event) => {
                      const values = Array.from(
                        event.target.selectedOptions,
                      ).map((option) => option.value);
                      setPage(1);
                      setSelectedFilters((previous) => ({
                        ...previous,
                        [key]: values,
                      }));
                    }}
                  >
                    {filters[key].map((value) => {
                      const optionValue = String(value);
                      return (
                        <option key={optionValue} value={optionValue}>
                          {optionValue}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ))}

              {RANGE_FILTER_KEYS.map((key) => (
                <label key={key} className="field">
                  <span>{FILTER_LABELS[key]}</span>
                  <input
                    type="number"
                    value={rangeFilters[key]}
                    onChange={(event) => {
                      setPage(1);
                      setRangeFilters((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                      }));
                    }}
                  />
                </label>
              ))}
            </>
          ) : (
            <p>Загрузка фильтров...</p>
          )}
        </aside>

        <main className="panel">
          <div className="toolbar">
            <input
              placeholder="Поиск по марке, модели, коду"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />

            <select
              value={sortBy}
              onChange={(event) => {
                setPage(1);
                setSortBy(event.target.value);
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={sortDir}
              onChange={(event) => {
                setPage(1);
                setSortDir(event.target.value);
              }}
            >
              <option value="desc">По убыванию</option>
              <option value="asc">По возрастанию</option>
            </select>

            <select
              value={String(pageSize)}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
            <Link className="switch-link" to="/">
              Открыть витрину
            </Link>
            <button type="button" className="secondary-button" onClick={clearFilters}>
              Сбросить фильтры
            </button>
          </div>

          {isLoading && <p>Загрузка каталога...</p>}

          {!isLoading && !hasImportedData && (
            <p className="empty">Импортированных данных пока нет.</p>
          )}

          {!isLoading && hasImportedData && items.length === 0 && (
            <p className="empty">По текущим фильтрам ничего не найдено.</p>
          )}

          {!isLoading && items.length > 0 && (
            <>
              <div className="table-wrap desktop-table">
                <table>
                  <thead>
                    <tr>
                      <th>Код предложения</th>
                      <th>Статус</th>
                      <th>Марка</th>
                      <th>Модель</th>
                      <th>Год</th>
                      <th>Пробег</th>
                      <th>Цена</th>
                      <th>Бронь</th>
                      <th>Место хранения</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.offerCode}</td>
                        <td>{item.status}</td>
                        <td>{item.brand}</td>
                        <td>{item.model}</td>
                        <td>{formatNumberValue(item.year)}</td>
                        <td>{formatNumberValue(item.mileageKm)}</td>
                        <td>{formatNumberValue(item.price)}</td>
                        <td>{item.bookingStatus}</td>
                        <td>{item.storageAddress}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mobile-cards">
                {items.map((item) => (
                  <article key={`mobile-${item.id}`} className="mobile-card">
                    <div className="mobile-card__head">
                      <strong>
                        {item.brand} {item.model}
                      </strong>
                      <span className="mobile-card__meta">Код: {item.offerCode}</span>
                    </div>
                    <dl className="mobile-card__list">
                      <div className="mobile-card__row">
                        <dt className="mobile-card__label">Статус</dt>
                        <dd className="mobile-card__value">{item.status}</dd>
                      </div>
                      <div className="mobile-card__row">
                        <dt className="mobile-card__label">Год</dt>
                        <dd className="mobile-card__value">{formatNumberValue(item.year)}</dd>
                      </div>
                      <div className="mobile-card__row">
                        <dt className="mobile-card__label">Пробег</dt>
                        <dd className="mobile-card__value">{formatNumberValue(item.mileageKm)}</dd>
                      </div>
                      <div className="mobile-card__row">
                        <dt className="mobile-card__label">Цена</dt>
                        <dd className="mobile-card__value">{formatNumberValue(item.price)}</dd>
                      </div>
                      <div className="mobile-card__row">
                        <dt className="mobile-card__label">Бронь</dt>
                        <dd className="mobile-card__value">{item.bookingStatus}</dd>
                      </div>
                      <div className="mobile-card__row">
                        <dt className="mobile-card__label">Место хранения</dt>
                        <dd className="mobile-card__value">{item.storageAddress}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <div className="pager">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Назад
                </button>
                <span>
                  Страница {page} из {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                >
                  Вперед
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
