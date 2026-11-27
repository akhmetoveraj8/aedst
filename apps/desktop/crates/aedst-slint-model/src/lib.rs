//! Keeps ONE Slint list model per property and updates it row by row.
//!
//! Setting a list property to a new `ModelRc` makes Slint drop and rebuild every row: the scroll
//! position, focus and per-row state are lost and every row is instantiated again. The Slint API docs
//! (`Model`): "It is more efficient to operate on the model and send changes through the ModelNotify
//! rather than resetting the property with a different model." [`sync_rows`] does that for the plain
//! "publish the whole list" views of the features: it keeps the `VecModel` the property already holds
//! and only notifies the rows that changed, were added or were removed. Rule M3 of
//! `docs/content/desktop/slint-rules.md`.
//!
//! Runs on the UI thread (a `ModelRc` is not `Send`); the comparison is linear and cheap (row data
//! are small structs of `SharedString`s and numbers).

use slint::{Model, ModelRc, VecModel};

/// Makes the model in `current` show `rows`, changing it in place.
///
/// Rows are matched by position: equal rows are left alone, changed rows get `set_row_data`, extra
/// rows are removed from the end and new rows are appended (so "load more" only adds rows). A row
/// inserted or removed in the middle therefore rewrites every later row's data (their instances are
/// kept, only per-row state that is not in the data follows the position, not the item).
///
/// Returns `None` when `current` was updated in place. Returns the model to set on the property when
/// `current` is not a `VecModel<T>`, which is the case on the first apply (the property still holds
/// its default, empty model); every later apply then updates that model.
#[must_use = "when Some, set the returned model on the property"]
pub fn sync_rows<T>(current: &ModelRc<T>, rows: Vec<T>) -> Option<ModelRc<T>>
where
    T: Clone + PartialEq + 'static,
{
    let Some(model) = current.as_any().downcast_ref::<VecModel<T>>() else {
        return Some(ModelRc::new(VecModel::from(rows)));
    };
    // Drop surplus rows from the end first (each removal is O(1) there).
    for index in (rows.len()..model.row_count()).rev() {
        model.remove(index);
    }
    let kept = model.row_count();
    let mut rows = rows.into_iter();
    for (index, row) in rows.by_ref().take(kept).enumerate() {
        if model.row_data(index).as_ref() != Some(&row) {
            model.set_row_data(index, row);
        }
    }
    model.extend(rows);
    None
}

/// [`sync_rows`] for a property: reads it with `get`, writes a model with `set` only on the first
/// apply.
pub fn apply_rows<T>(get: impl FnOnce() -> ModelRc<T>, set: impl FnOnce(ModelRc<T>), rows: Vec<T>)
where
    T: Clone + PartialEq + 'static,
{
    if let Some(model) = sync_rows(&get(), rows) {
        set(model);
    }
}

#[cfg(test)]
mod tests {
    use std::rc::Rc;

    use slint::{Model, ModelRc, VecModel};

    use super::sync_rows;

    fn rows(model: &ModelRc<i32>) -> Vec<i32> {
        model.iter().collect()
    }

    #[test]
    fn the_first_apply_creates_a_model_and_later_ones_reuse_it() {
        let empty = ModelRc::<i32>::default();
        let first = sync_rows(&empty, vec![1, 2, 3]);
        let model = first.expect("first apply sets a model");
        assert_eq!(rows(&model), [1, 2, 3]);

        let in_place = sync_rows(&model, vec![1, 5, 3]);
        assert!(in_place.is_none(), "updated in place");
        assert_eq!(rows(&model), [1, 5, 3]);
    }

    #[test]
    fn rows_are_appended_and_removed_at_the_end() {
        let inner = Rc::new(VecModel::from(vec![1, 2]));
        let model = ModelRc::from(Rc::clone(&inner));

        assert!(sync_rows(&model, vec![1, 2, 3, 4]).is_none());
        assert_eq!(rows(&model), [1, 2, 3, 4]);

        assert!(sync_rows(&model, vec![9]).is_none());
        assert_eq!(rows(&model), [9]);

        assert!(sync_rows(&model, Vec::new()).is_none());
        assert_eq!(model.row_count(), 0);
        assert_eq!(inner.row_count(), 0, "the same VecModel was changed");
    }
}
