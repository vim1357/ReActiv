import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  clearImports,
  getImportBatchDetails,
  getImportBatches,
  uploadImport,
} from "../api/client";
import type {
  ImportBatchDetailsResponse,
  ImportBatchListItem,
  ImportResponse,
} from "../types/api";

interface UploadPageProps {
  canAccessCatalog?: boolean;
}

function getStatusTone(
  status: ImportResponse["status"],
): "good" | "warn" | "bad" {
  if (status === "completed") {
    return "good";
  }
  if (status === "completed_with_errors") {
    return "warn";
  }
  return "bad";
}

function getStatusLabel(status: ImportResponse["status"]): string {
  if (status === "completed") {
    return "Завершен";
  }
  if (status === "completed_with_errors") {
    return "Завершен с предупреждениями";
  }
  return "Ошибка";
}

function mapBatchDetailsToImportResponse(
  details: ImportBatchDetailsResponse,
): ImportResponse {
  return {
    importBatchId: details.importBatch.id,
    status: details.importBatch.status,
    summary: {
      totalRows: details.importBatch.total_rows,
      importedRows: details.importBatch.imported_rows,
      skippedRows: details.importBatch.skipped_rows,
      addedRows: details.importBatch.added_rows,
      updatedRows: details.importBatch.updated_rows,
      removedRows: details.importBatch.removed_rows,
      unchangedRows: details.importBatch.unchanged_rows,
    },
    errors: details.errors.map((item) => ({
      rowNumber: item.row_number,
      field: item.field,
      message: item.message,
    })),
  };
}

export function UploadPage({ canAccessCatalog = true }: UploadPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [history, setHistory] = useState<ImportBatchListItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function loadHistory() {
    try {
      setHistoryError(null);
      const response = await getImportBatches(20);
      setHistory(response.items);
      const latestImportId = response.items[0]?.id;

      if (!latestImportId) {
        setResult(null);
        return;
      }

      const details = await getImportBatchDetails(latestImportId);
      setResult(mapBatchDetailsToImportResponse(details));
    } catch {
      setHistoryError("Не удалось загрузить историю импортов");
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Выберите файл .xlsx");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    setResult(null);

    try {
      const response = await uploadImport(file);
      setResult(response);
      if (response.summary.importedRows > 0) {
        setSuccess(
          `Файл «${file.name}» загружен. Данные добавлены в витрину.`,
        );
      } else {
        setSuccess(
          `Файл «${file.name}» обработан, но записи в витрину не добавлены.`,
        );
      }
      await loadHistory();
    } catch (caughtError) {
      if (caughtError instanceof Error) {
        setError(caughtError.message);
      } else {
        setError("Загрузка не удалась");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleClearImports(): Promise<void> {
    const confirmed = window.confirm(
      "Удалить все импортированные данные? Будут очищены записи каталога и история импортов.",
    );

    if (!confirmed) {
      return;
    }

    setIsClearing(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await clearImports();
      setResult(null);
      await loadHistory();
      setSuccess(
        `Удалено: предложений ${response.vehicleOffersDeleted}, импортов ${response.importBatchesDeleted}, ошибок ${response.importErrorsDeleted}.`,
      );
    } catch (caughtError) {
      if (caughtError instanceof Error) {
        setError(caughtError.message);
      } else {
        setError("Не удалось очистить импортированные данные");
      }
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <section>
      <h1>Загрузите excel-файл с лотами</h1>
      <form className="panel upload-form" onSubmit={handleSubmit}>
        <input
          type="file"
          accept=".xlsx"
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setFile(selected);
          }}
        />
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Загрузка..." : "Загрузить"}
        </button>
        <button
          type="button"
          className="secondary-button danger-button"
          disabled={isClearing}
          onClick={() => {
            void handleClearImports();
          }}
        >
          {isClearing ? "Очистка..." : "Очистить импортированные данные"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {result && (
        <div className="panel import-summary">
          <div className="summary-head">
            <h2>Сводка импорта</h2>
            <span className={`status-pill ${getStatusTone(result.status)}`}>
              {getStatusLabel(result.status)}
            </span>
          </div>

          <div className="summary-grid">
            <div className="summary-item">
              <span>Всего</span>
              <strong>{result.summary.totalRows}</strong>
            </div>
            <div className="summary-item">
              <span>Импортировано</span>
              <strong>{result.summary.importedRows}</strong>
            </div>
            <div className="summary-item">
              <span>Пропущено</span>
              <strong>{result.summary.skippedRows}</strong>
            </div>
            <div className="summary-item">
              <span>Добавлено</span>
              <strong>{result.summary.addedRows}</strong>
            </div>
            <div className="summary-item">
              <span>Обновлено</span>
              <strong>{result.summary.updatedRows}</strong>
            </div>
            <div className="summary-item">
              <span>Ушло</span>
              <strong>{result.summary.removedRows}</strong>
            </div>
            <div className="summary-item">
              <span>Без изменений</span>
              <strong>{result.summary.unchangedRows}</strong>
            </div>
          </div>

          <p>
            <Link className="summary-link" to={canAccessCatalog ? "/catalog" : "/showcase"}>
              {canAccessCatalog ? "Открыть каталог" : "Открыть витрину"}
            </Link>
          </p>

          {result.errors.length > 0 && (
            <>
              <h3>Предупреждения</h3>
              <div className="table-wrap desktop-table">
                <table>
                  <thead>
                    <tr>
                      <th>Строка</th>
                      <th>Поле</th>
                      <th>Сообщение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((item, index) => (
                      <tr key={`${item.rowNumber}-${item.field}-${index}`}>
                        <td>{item.rowNumber}</td>
                        <td>{item.field ?? "-"}</td>
                        <td>{item.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-cards">
                {result.errors.map((item, index) => (
                  <article
                    key={`mobile-${item.rowNumber}-${item.field}-${index}`}
                    className="mobile-card"
                  >
                    <div className="mobile-card__head">
                      <strong>Предупреждение в строке {item.rowNumber}</strong>
                    </div>
                    <dl className="mobile-card__list">
                      <div className="mobile-card__row">
                        <dt className="mobile-card__label">Поле</dt>
                        <dd className="mobile-card__value">{item.field ?? "-"}</dd>
                      </div>
                      <div className="mobile-card__row">
                        <dt className="mobile-card__label">Сообщение</dt>
                        <dd className="mobile-card__value">{item.message}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="panel recent-imports">
        <h2>Загруженные файлы</h2>
        {historyError && <p className="error">{historyError}</p>}
        {history.length === 0 ? (
          <p className="empty">Импортов пока нет.</p>
        ) : (
          <>
          <div className="table-wrap desktop-table">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Файл</th>
                  <th>Статус</th>
                  <th>Всего</th>
                  <th>Импортировано</th>
                  <th>Пропущено</th>
                  <th>Добавлено</th>
                  <th>Обновлено</th>
                  <th>Ушло</th>
                  <th>Без изменений</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.created_at}</td>
                    <td>{item.filename}</td>
                    <td>{getStatusLabel(item.status)}</td>
                    <td>{item.total_rows}</td>
                    <td>{item.imported_rows}</td>
                    <td>{item.skipped_rows}</td>
                    <td>{item.added_rows}</td>
                    <td>{item.updated_rows}</td>
                    <td>{item.removed_rows}</td>
                    <td>{item.unchanged_rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-cards">
            {history.map((item) => (
              <article key={`mobile-${item.id}`} className="mobile-card">
                <div className="mobile-card__head">
                  <strong>{item.filename}</strong>
                  <span className="mobile-card__meta">{item.created_at}</span>
                </div>
                <dl className="mobile-card__list">
                  <div className="mobile-card__row">
                    <dt className="mobile-card__label">Статус</dt>
                    <dd className="mobile-card__value">{getStatusLabel(item.status)}</dd>
                  </div>
                  <div className="mobile-card__row">
                    <dt className="mobile-card__label">Всего</dt>
                    <dd className="mobile-card__value">{item.total_rows}</dd>
                  </div>
                  <div className="mobile-card__row">
                    <dt className="mobile-card__label">Импортировано</dt>
                    <dd className="mobile-card__value">{item.imported_rows}</dd>
                  </div>
                  <div className="mobile-card__row">
                    <dt className="mobile-card__label">Пропущено</dt>
                    <dd className="mobile-card__value">{item.skipped_rows}</dd>
                  </div>
                  <div className="mobile-card__row">
                    <dt className="mobile-card__label">Добавлено</dt>
                    <dd className="mobile-card__value">{item.added_rows}</dd>
                  </div>
                  <div className="mobile-card__row">
                    <dt className="mobile-card__label">Обновлено</dt>
                    <dd className="mobile-card__value">{item.updated_rows}</dd>
                  </div>
                  <div className="mobile-card__row">
                    <dt className="mobile-card__label">Ушло</dt>
                    <dd className="mobile-card__value">{item.removed_rows}</dd>
                  </div>
                  <div className="mobile-card__row">
                    <dt className="mobile-card__label">Без изменений</dt>
                    <dd className="mobile-card__value">{item.unchanged_rows}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          </>
        )}
      </div>
    </section>
  );
}
