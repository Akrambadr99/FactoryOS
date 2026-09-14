export interface Migration<T> {
    from: number;
    to: number;
    run: (value: T) => T;
}
export function migrate<T extends {
    schema: number;
}>(value: T, target: number, migrations: readonly Migration<T>[]): T {
    let current = value;
    while (current.schema < target) {
        const migration = migrations.find(item => item.from === current.schema);
        if (!migration)
            throw new Error('Missing migration from schema ' + String(current.schema));
        current = migration.run(current);
        if (current.schema !== migration.to)
            throw new Error('Migration did not advance schema');
    }
    return current;
}
