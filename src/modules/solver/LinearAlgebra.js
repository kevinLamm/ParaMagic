export function transpose(matrix) {
  if (!matrix.length) return [];
  return Array.from({ length: matrix[0].length }, (_, column) => matrix.map((row) => row[column]));
}

export function multiply(left, right) {
  if (!left.length || !right.length) return [];
  const result = Array.from({ length: left.length }, () => Array(right[0].length).fill(0));
  for (let row = 0; row < left.length; row += 1) {
    for (let inner = 0; inner < right.length; inner += 1) {
      for (let column = 0; column < right[0].length; column += 1) result[row][column] += left[row][inner] * right[inner][column];
    }
  }
  return result;
}

export function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

export function squaredNorm(vector) {
  return vector.reduce((sum, value) => sum + value * value, 0);
}

export function solveLinearSystem(matrix, vector, pivotTolerance = 1e-12) {
  const size = matrix.length;
  if (size === 0) return [];
  if (matrix.some((row) => row.length !== size) || vector.length !== size) throw new Error('Linear system dimensions do not match.');
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    if (Math.abs(augmented[pivotRow][column]) < pivotTolerance) throw new Error('Singular or ill-conditioned linear system.');
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / augmented[column][column];
      for (let item = column; item <= size; item += 1) augmented[row][item] -= factor * augmented[column][item];
    }
  }
  const solution = Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = augmented[row][size];
    for (let column = row + 1; column < size; column += 1) value -= augmented[row][column] * solution[column];
    solution[row] = value / augmented[row][row];
    if (!Number.isFinite(solution[row])) throw new Error('Linear solve produced a non-finite value.');
  }
  return solution;
}
