type PositiveNumberOptions = {
  integer?: boolean;
};

export const isPositiveNumber = (
  value: number,
  options: PositiveNumberOptions = {}
) => {
  const isValidNumber = options.integer
    ? Number.isInteger(value)
    : Number.isFinite(value);

  return isValidNumber && value > 0;
};

export const formatSubscriptionDate = (date: string) =>
  new Date(date).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
