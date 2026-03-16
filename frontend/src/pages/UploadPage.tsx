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
  ImportTenantId,
} from "../types/api";

interface UploadPageProps {
  canAccessCatalog?: boolean;
}

interface ImportWarningSummaryItem {
  field: string | null;
  summary: string;
  count: number;
}

const IMPORT_TENANTS: Array<{ id: ImportTenantId; label: string }> = [
  { id: "gpb", label: "ГПБ Лизинг" },
  { id: "reso", label: "РЕСО Лизинг" },
  { id: "alpha", label: "Альфа Лизинг" },
];

function getTenantLabel(tenantId: ImportTenantId): string {
  return IMPORT_TENANTS.find((item) => item.id === tenantId)?.label ?? tenantId;
}

function isCriticalImportError(error: ImportResponse["errors"][number]): boolean {
  return error.field === "offer_code" || error.field === "brand";
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
    tenantId: details.importBatch.tenant_id,
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

function getFieldLabel(field: string | null): string {
  switch (field) {
    case "offer_code":
      return "Код предложения";
    case "brand":
      return "Марка";
    case "model":
      return "Модель";
    case "modification":
      return "Модификация";
    case "vehicle_type":
      return "Тип техники";
    case "year":
      return "Год";
    case "mileage_km":
      return "Пробег";
    case "key_count":
      return "Количество ключей";
    case "pts_type":
      return "Тип ПТС";
    case "has_encumbrance":
      return "Обременение";
    case "is_deregistered":
      return "Снят с учета";
    case "responsible_person":
      return "Ответственный";
    case "storage_address":
      return "Адрес хранения";
    case "days_on_sale":
      return "Дней в продаже";
    case "price":
      return "Цена";
    case "yandex_disk_url":
      return "Ссылка на фото";
    case "booking_status":
      return "Статус брони";
    case "external_id":
      return "Внешний ID";
    case "crm_ref":
      return "CRM ref";
    case "website_url":
      return "Ссылка на источник";
    default:
      return field ?? "Общее";
  }
}

function getWarningText(field: string | null, message: string): string {
  if (message === "Required field is empty") {
    return "Обязательное поле пустое";
  }

  if (message === "Field is empty") {
    return `Не заполнено поле «${getFieldLabel(field)}»`;
  }

  if (message === "Deregistration date is empty") {
    return "Не заполнена дата «Снят с учета»";
  }

  if (message === "Duplicate offer_code in the import file") {
    return "Дубликат кода предложения в файле";
  }

  if (message.startsWith("Missing required column:")) {
    return "В файле отсутствует обязательная колонка";
  }

  if (message.startsWith("Invalid ")) {
    return `Некорректное значение поля «${getFieldLabel(field)}»`;
  }

  return message;
}

function buildWarningSummary(
  errors: ImportResponse["errors"],
): ImportWarningSummaryItem[] {
  const grouped = new Map<string, ImportWarningSummaryItem>();

  errors.forEach((item) => {
    const summary = getWarningText(item.field, item.message);
    const groupKey = `${item.field ?? "general"}::${summary}`;
    const existing = grouped.get(groupKey);

    if (existing) {
      existing.count += 1;
      return;
    }

    grouped.set(groupKey, {
      field: item.field,
      summary,
      count: 1,
    });
  });

  return Array.from(grouped.values()).sort((left, right) => right.count - left.count);
}

export function UploadPage({ canAccessCatalog = true }: UploadPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [tenantId, setTenantId] = useState<ImportTenantId>("gpb");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [history, setHistory] = useState<ImportBatchListItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const criticalErrors = result
    ? result.errors.filter((item) => isCriticalImportError(item))
    : [];
  const warningErrors = result
    ? result.errors.filter((item) => !isCriticalImportError(item))
    : [];
  const criticalSummary = buildWarningSummary(criticalErrors);
  const warningSummary = buildWarningSummary(warningErrors);

  async function loadHistory() {
    try {
      setHistoryError(null);
      const response = await getImportBatches(20, tenantId);
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
  }, [tenantId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Выберите файл .xlsx или .xls");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    setResult(null);

    try {
      const response = await uploadImport(file, tenantId);
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
      const response = await clearImports(tenantId);
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
        <label htmlFor="tenantIdSelect">Лизингодатель</label>
        <select
          id="tenantIdSelect"
          value={tenantId}
          onChange={(event) => {
            setTenantId(event.target.value as ImportTenantId);
          }}
          disabled={isSubmitting || isClearing}
        >
          {IMPORT_TENANTS.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.label}
            </option>
          ))}
        </select>

        <input
          type="file"
          accept=".xlsx,.xls"
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
              <span>Лизингодатель</span>
              <strong>{getTenantLabel(result.tenantId)}</strong>
              <p className="summary-item__hint">
                профиль, по которому разобран текущий файл
              </p>
            </div>
            <div className="summary-item">
              <span>Новые поступления</span>
              <strong>{result.summary.addedRows}</strong>
              <p className="summary-item__hint">
                новые коды предложения в текущем файле
              </p>
            </div>
            <div className="summary-item">
              <span>Проданная / выбывшая техника</span>
              <strong>{result.summary.removedRows}</strong>
              <p className="summary-item__hint">
                коды предложения, которых больше нет в новом файле
              </p>
            </div>
            <div className="summary-item">
              <span>Не загружено в витрину</span>
              <strong>{result.summary.skippedRows}</strong>
              <p className="summary-item__hint">
                строки без кода предложения или марки
              </p>
            </div>
            <div className="summary-item">
              <span>Всего строк в файле</span>
              <strong>{result.summary.totalRows}</strong>
              <p className="summary-item__hint">
                все строки из загруженного Excel-файла
              </p>
            </div>
            <div className="summary-item">
              <span>Загружено в витрину</span>
              <strong>{result.summary.importedRows}</strong>
              <p className="summary-item__hint">
                строки, прошедшие валидацию и попавшие в актуальный сток
              </p>
            </div>
            <div className="summary-item">
              <span>Совпало с прошлой загрузкой</span>
              <strong>{result.summary.unchangedRows}</strong>
              <p className="summary-item__hint">
                коды предложения, которые уже были в прошлом файле
              </p>
            </div>
          </div>

          <p className="summary-note">
            Изменения внутри существующих кодов предложения сейчас не считаются
            отдельной метрикой, поэтому «Обновлено» не используется.
          </p>

          <p>
            <Link className="summary-link" to={canAccessCatalog ? "/catalog" : "/"}>
              {canAccessCatalog ? "Открыть каталог" : "Открыть витрину"}
            </Link>
          </p>

          {criticalErrors.length > 0 && (
            <>
              <h3>Критичные ошибки</h3>
              <div className="summary-grid import-warning-summary-grid">
                {criticalSummary.map((item, index) => (
                  <div
                    key={`critical-${item.field ?? "general"}-${item.summary}-${index}`}
                    className="summary-item import-warning-summary-item"
                  >
                    <span>
                      {item.field ? getFieldLabel(item.field) : "Критичная ошибка"}
                    </span>
                    <strong>{item.count}</strong>
                    <p>{item.summary}</p>
                  </div>
                ))}
              </div>

              <details className="import-warning-details">
                <summary>
                  Показать детали критичных ошибок ({criticalErrors.length})
                </summary>
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
                      {criticalErrors.map((item, index) => (
                        <tr key={`critical-${item.rowNumber}-${item.field}-${index}`}>
                          <td>{item.rowNumber}</td>
                          <td>{getFieldLabel(item.field)}</td>
                          <td>{getWarningText(item.field, item.message)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-cards">
                  {criticalErrors.map((item, index) => (
                    <article
                      key={`mobile-critical-${item.rowNumber}-${item.field}-${index}`}
                      className="mobile-card"
                    >
                      <div className="mobile-card__head">
                        <strong>Критичная ошибка в строке {item.rowNumber}</strong>
                      </div>
                      <dl className="mobile-card__list">
                        <div className="mobile-card__row">
                          <dt className="mobile-card__label">Поле</dt>
                          <dd className="mobile-card__value">{getFieldLabel(item.field)}</dd>
                        </div>
                        <div className="mobile-card__row">
                          <dt className="mobile-card__label">Сообщение</dt>
                          <dd className="mobile-card__value">
                            {getWarningText(item.field, item.message)}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              </details>
            </>
          )}

          {warningErrors.length > 0 && (
            <>
              <h3>Предупреждения</h3>
              <div className="summary-grid import-warning-summary-grid">
                {warningSummary.map((item, index) => (
                  <div
                    key={`${item.field ?? "general"}-${item.summary}-${index}`}
                    className="summary-item import-warning-summary-item"
                  >
                    <span>
                      {item.field ? getFieldLabel(item.field) : "Общее предупреждение"}
                    </span>
                    <strong>{item.count}</strong>
                    <p>{item.summary}</p>
                  </div>
                ))}
              </div>

              <details className="import-warning-details">
                <summary>
                  Показать детали предупреждений ({warningErrors.length})
                </summary>
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
                      {warningErrors.map((item, index) => (
                        <tr key={`${item.rowNumber}-${item.field}-${index}`}>
                          <td>{item.rowNumber}</td>
                          <td>{getFieldLabel(item.field)}</td>
                          <td>{getWarningText(item.field, item.message)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-cards">
                  {warningErrors.map((item, index) => (
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
                          <dd className="mobile-card__value">{getFieldLabel(item.field)}</dd>
                        </div>
                        <div className="mobile-card__row">
                          <dt className="mobile-card__label">Сообщение</dt>
                          <dd className="mobile-card__value">
                            {getWarningText(item.field, item.message)}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              </details>
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
                  <th>Лизингодатель</th>
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
                    <td>{getTenantLabel(item.tenant_id)}</td>
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
                    <dt className="mobile-card__label">Лизингодатель</dt>
                    <dd className="mobile-card__value">{getTenantLabel(item.tenant_id)}</dd>
                  </div>
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
