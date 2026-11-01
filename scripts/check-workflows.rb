#!/usr/bin/env ruby
# frozen_string_literal: true

# Enforces the repository's workflow hardening conventions beyond what actionlint checks.
require 'yaml'

ROOT = File.expand_path('..', __dir__)
PINNED_ACTION = %r{\A[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}\z}.freeze
EXPRESSION = /\$\{\{/.freeze

def relative(path)
  path.delete_prefix("#{ROOT}/")
end

def load_yaml(path)
  YAML.safe_load(File.read(path)) || {}
rescue Psych::Exception => e
  raise "#{relative(path)}: invalid YAML (#{e.message})"
end

# Psych follows YAML 1.1, where a bare `on` key parses as true.
def triggers(workflow)
  value = workflow.key?('on') ? workflow['on'] : workflow[true]
  case value
  when Hash then value.keys.map(&:to_s)
  when Array then value.map(&:to_s)
  when String then [value]
  else []
  end
end

def check_step(errors, where, step, pull_request_target:)
  unless step.is_a?(Hash)
    errors << "#{where}: step must be a mapping"
    return
  end
  uses = step['uses']
  if step.key?('run') && step['run'].to_s.match?(EXPRESSION)
    errors << "#{where}: pass expressions to run scripts through env instead of interpolating them"
  end
  return unless uses

  if uses.start_with?('./')
    target = File.join(ROOT, uses)
    unless File.exist?(File.join(target, 'action.yml')) || File.exist?(File.join(target, 'action.yaml'))
      errors << "#{where}: local action #{uses} has no action.yml"
    end
  elsif uses.start_with?('docker://')
    errors << "#{where}: docker actions are not allowed"
  elsif !uses.match?(PINNED_ACTION)
    errors << "#{where}: pin #{uses} to a full commit SHA"
  end

  return unless uses.start_with?('actions/checkout@')

  inputs = step['with'] || {}
  if !inputs.key?('repository') && inputs['persist-credentials'] != false
    errors << "#{where}: checkout of this repository must set persist-credentials: false"
  end
  if pull_request_target && (inputs.key?('ref') || inputs.key?('repository'))
    errors << "#{where}: pull_request_target workflows must only check out trusted base code"
  end
end

def check_workflow(errors, path)
  workflow = load_yaml(path)
  name = relative(path)
  events = triggers(workflow)
  errors << "#{name}: declares no triggers" if events.empty?
  errors << "#{name}: declare top-level permissions" unless workflow.key?('permissions')
  pull_request_target = events.include?('pull_request_target')

  jobs = workflow['jobs']
  unless jobs.is_a?(Hash) && !jobs.empty?
    errors << "#{name}: declares no jobs"
    return
  end

  jobs.each do |job_id, job|
    where = "#{name} job #{job_id}"
    if job['uses']
      reusable = job['uses'].to_s
      if reusable.start_with?('./')
        errors << "#{where}: reusable workflow #{reusable} does not exist" unless File.file?(File.join(ROOT, reusable))
      elsif !reusable.match?(PINNED_ACTION)
        errors << "#{where}: pin reusable workflow #{reusable} to a full commit SHA"
      end
      next
    end

    errors << "#{where}: set timeout-minutes" unless job['timeout-minutes'].is_a?(Integer)
    if pull_request_target && !job.key?('permissions')
      errors << "#{where}: pull_request_target jobs must declare their own permissions"
    end
    (job['steps'] || []).each_with_index do |step, index|
      label = step.is_a?(Hash) && step['name'] ? step['name'] : "##{index + 1}"
      check_step(errors, "#{where} step #{label}", step, pull_request_target: pull_request_target)
    end
  end
end

def check_action(errors, path)
  action = load_yaml(path)
  name = relative(path)
  runs = action['runs'] || {}
  unless runs['using'] == 'composite'
    errors << "#{name}: only composite local actions are supported"
    return
  end
  (runs['steps'] || []).each_with_index do |step, index|
    label = step.is_a?(Hash) && step['name'] ? step['name'] : "##{index + 1}"
    where = "#{name} step #{label}"
    errors << "#{where}: composite run steps must set shell" if step.is_a?(Hash) && step.key?('run') && !step['shell']
    check_step(errors, where, step, pull_request_target: false)
  end
end

errors = []
workflows = Dir.glob(File.join(ROOT, '.github/workflows/*.{yml,yaml}')).sort
actions = Dir.glob(File.join(ROOT, '.github/actions/*/action.{yml,yaml}')).sort
begin
  errors << '.github/workflows: no workflows found' if workflows.empty?
  workflows.each { |path| check_workflow(errors, path) }
  actions.each { |path| check_action(errors, path) }
rescue RuntimeError => e
  errors << e.message
end

if errors.empty?
  puts "Checked #{workflows.length} workflows and #{actions.length} local actions."
else
  errors.each { |error| warn "::error::#{error}" }
  exit 1
end
